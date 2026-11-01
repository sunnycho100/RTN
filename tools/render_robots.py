"""Render one uniform tile per robot for the "What you get" section: same camera angle, framing and lighting, transparent
background, tinted to the site palette. MuJoCo Menagerie models (licenses in each model folder) plus our own M0617
simulation model (capsules on the vendor kinematics, as in robot_consult_demo s6a build.py).

Run with the robot repo's sim venv:
  ~/Documents/projects/robot/sim/mujoco_houses/.venv/bin/python tools/render_robots.py --robot-repo ~/Documents/projects/robot
"""
import argparse, os, struct, sys, zlib
import mujoco
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("--robot-repo", default=os.path.expanduser("~/Documents/projects/robot"))
ap.add_argument("--size", type=int, default=256)
ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "media", "robots"))
args = ap.parse_args()
MEN = os.path.join(os.path.expanduser(args.robot_repo), "sim", "menagerie")
SS = 4                                   # supersampling for smooth edges
RAMP = [(0.0, (0x1a, 0x23, 0x22)), (0.55, (0x6f, 0xe0, 0xcf)), (1.0, (0xea, 0xf5, 0xf2))]   # site panel, accent, ink

ROBOTS = [   # (file stem, label, model loader)
    ("g1", "Unitree G1", "unitree_g1/g1.xml"), ("h1", "Unitree H1", "unitree_h1/h1.xml"), ("go2", "Unitree Go2", "unitree_go2/go2.xml"),
    ("spot", "Boston Dynamics Spot", "boston_dynamics_spot/spot.xml"), ("anymal", "ANYbotics ANYmal C", "anybotics_anymal_c/anymal_c.xml"),
    ("panda", "Franka Panda", "franka_emika_panda/panda.xml"), ("ur10e", "Universal Robots UR10e", "universal_robots_ur10e/ur10e.xml"),
    ("m0617", "Doosan M0617", None),
]


def load(xml):
    if xml:
        m = mujoco.MjModel.from_xml_path(os.path.join(MEN, xml)); d = mujoco.MjData(m)
        if m.nkey: mujoco.mj_resetDataKeyframe(m, d, 0)
        return m, d
    # same chain as robot_consult_demo s6a models/build.py child_spec (base cylinder, joint spheres, link capsules of
    # radius 0.055 m), rebuilt here with MuJoCo's own euler conversion so it needs no scipy
    import json
    J = json.load(open(os.path.join(os.path.expanduser(args.robot_repo), "robot_consult_demo/src/rcd/s6a_robot_sim/models/m0617.json")))["joints"]
    spec = mujoco.MjSpec(); spec.compiler.degree = False; parent = spec.worldbody.add_body(name="base")
    parent.add_geom(type=mujoco.mjtGeom.mjGEOM_CYLINDER, size=[0.09, J[0]["xyz"][2] / 2, 0], pos=[0, 0, J[0]["xyz"][2] / 2])
    for i, j in enumerate(J):
        q = np.zeros(4); mujoco.mju_euler2Quat(q, np.array(j["rpy"], float), "XYZ")   # URDF rpy: fixed-axis roll, pitch, yaw
        bd = parent.add_body(pos=list(map(float, j["xyz"])), quat=list(q))
        bd.add_joint(type=mujoco.mjtJoint.mjJNT_HINGE, axis=list(map(float, j["axis"])))
        bd.add_geom(type=mujoco.mjtGeom.mjGEOM_SPHERE, size=[0.055 * 0.9, 0, 0])
        nxt = J[i + 1]["xyz"] if i + 1 < len(J) else [0, 0, 0]
        if np.linalg.norm(nxt) > 1e-3: bd.add_geom(type=mujoco.mjtGeom.mjGEOM_CAPSULE, fromto=[0, 0, 0] + list(map(float, nxt)), size=[0.055, 0, 0])
        parent = bd
    m = spec.compile(); d = mujoco.MjData(m)
    d.qpos[:6] = [0.4, -0.5, 1.7, 0.0, 1.1, 0.0][: m.nq]   # a working pose; the vendor zero pose is a straight vertical stick
    return m, d


def png(path, rgba):
    h, w = rgba.shape[:2]; raw = b"".join(b"\0" + rgba[y].tobytes() for y in range(h))
    chunk = lambda t, b: struct.pack(">I", len(b)) + t + b + struct.pack(">I", zlib.crc32(t + b) & 0xFFFFFFFF)
    open(path, "wb").write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
                          + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def render(m, d, n):
    mujoco.mj_forward(m, d)
    m.vis.headlight.ambient[:] = 0.35; m.vis.headlight.diffuse[:] = 0.65; m.vis.headlight.specular[:] = 0.1
    m.vis.global_.offwidth = max(m.vis.global_.offwidth, n); m.vis.global_.offheight = max(m.vis.global_.offheight, n)
    vis = [g for g in range(m.ngeom) if m.geom_group[g] <= 2 and m.geom_type[g] != mujoco.mjtGeom.mjGEOM_PLANE]
    lo = np.min([d.geom_xpos[g] - m.geom_rbound[g] for g in vis], 0); hi = np.max([d.geom_xpos[g] + m.geom_rbound[g] for g in vis], 0)
    cam = mujoco.MjvCamera(); cam.lookat[:] = (lo + hi) / 2; cam.azimuth, cam.elevation = 135, -14
    cam.distance = 0.5 * np.linalg.norm(hi - lo) / np.tan(np.radians(m.vis.global_.fovy / 2)) * 1.02
    r = mujoco.Renderer(m, n, n); r.update_scene(d, camera=cam); rgb = r.render().astype(float) / 255
    r.enable_segmentation_rendering(); r.update_scene(d, camera=cam); mask = (r.render()[:, :, 0] >= 0).astype(float); r.close()
    return rgb, mask


os.makedirs(args.out, exist_ok=True)
for stem, label, xml in ROBOTS:
    m, d = load(xml)
    rgb, mask = render(m, d, args.size * SS)
    L = rgb @ [0.299, 0.587, 0.114]; inside = L[mask > 0]
    a, b = np.percentile(inside, 3), np.percentile(inside, 97); L = np.clip((L - a) / max(b - a, 1e-6), 0, 1)   # same contrast for every robot
    col = np.zeros(rgb.shape)
    for (t0, c0), (t1, c1) in zip(RAMP, RAMP[1:]):
        u = np.clip((L - t0) / (t1 - t0), 0, 1)[..., None]; seg = ((L >= t0) & (L <= t1))[..., None]
        col = np.where(seg, np.array(c0) + (np.array(c1) - np.array(c0)) * u, col)
    rgba = np.concatenate([col, mask[..., None] * 255], -1)
    n = args.size; rgba = rgba.reshape(n, SS, n, SS, 4)
    al = rgba[..., 3:].mean((1, 3)); c = (rgba[..., :3] * rgba[..., 3:]).mean((1, 3)) / np.maximum(al, 1e-6)   # premultiplied box filter
    out = np.concatenate([c, al], -1).clip(0, 255).astype(np.uint8)
    png(os.path.join(args.out, stem + ".png"), out)
    print(stem, label, os.path.getsize(os.path.join(args.out, stem + ".png")) // 1024, "KB")
