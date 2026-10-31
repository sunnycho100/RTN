"""Export robot motion for the landing page to robots.js: points sampled on each body (body frame) plus body poses per frame.

Run with the robot repo's sim venv (it has mujoco and the G1 demo):
  ~/Documents/projects/robot/sim/mujoco_houses/.venv/bin/python tools/export_robots.py --robot-repo ~/Documents/projects/robot

coop: two 23-DoF G1s carrying one box, recorded from the real MuJoCo policy run (unitree_demo.coop_lift).
arm, quad: Menagerie Panda and Go2 with scripted joint motion, stand-ins until policy runs exist.
Units: positions in mm, quaternions (w, x, y, z) times 1000.
"""
import argparse, json, math, os, sys
import mujoco
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("--robot-repo", default=os.path.expanduser("~/Documents/projects/robot"))
ap.add_argument("--fps", type=int, default=15)
ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "robots.js"))
args = ap.parse_args()
REPO = os.path.expanduser(args.robot_repo)
G = mujoco.mjtGeom


def quat_mat(q):
    m = np.zeros(9); mujoco.mju_quat2Mat(m, np.asarray(q, dtype=float)); return m.reshape(3, 3)


def geom_points(model, g):
    t, s = model.geom_type[g], model.geom_size[g]
    if t == G.mjGEOM_MESH:
        m = model.geom_dataid[g]; a, n = model.mesh_vertadr[m], model.mesh_vertnum[m]
        return model.mesh_vert[a:a + n].astype(float)
    if t == G.mjGEOM_BOX:  # points on the surface grid
        u = np.linspace(-1, 1, 6); P = []
        for ax in range(3):
            for sign in (-1, 1):
                for i in u:
                    for j in u:
                        p = np.zeros(3); p[ax] = sign; p[(ax + 1) % 3] = i; p[(ax + 2) % 3] = j; P.append(p * s[:3])
        return np.array(P)
    if t in (G.mjGEOM_CAPSULE, G.mjGEOM_CYLINDER):
        r, h = s[0], s[1]; ang = np.linspace(0, 2 * math.pi, 8, endpoint=False)
        return np.array([[r * math.cos(a), r * math.sin(a), z] for z in np.linspace(-h, h, 5) for a in ang])
    if t == G.mjGEOM_SPHERE:
        r = s[0]; return np.array([[r * math.cos(a) * math.cos(b), r * math.sin(a) * math.cos(b), r * math.sin(b)]
                                   for a in np.linspace(0, 2 * math.pi, 8, endpoint=False) for b in (-0.8, 0, 0.8)])
    return None  # planes, heightfields


def body_points(model, cap):
    """Points per body in the body frame, voxel-thinned then capped."""
    per = {}
    for g in range(model.ngeom):
        b = model.geom_bodyid[g]
        if b == 0:
            continue
        P = geom_points(model, g)
        if P is None or not len(P):
            continue
        per.setdefault(b, []).append(P @ quat_mat(model.geom_quat[g]).T + model.geom_pos[g])
    out = {}
    for b, parts in per.items():
        P = np.concatenate(parts)
        _, idx = np.unique(np.floor(P / 0.025).astype(np.int64), axis=0, return_index=True)
        P = P[np.sort(idx)]
        if len(P) > cap:
            P = P[np.linspace(0, len(P) - 1, cap).astype(int)]
        out[b] = P
    return out


def pack(model, pts, frames, accent=()):
    bodies = sorted(pts)
    return {
        "fps": args.fps, "frames": len(frames),
        "bodies": [{"p": np.round(pts[b] * 1000).astype(int).ravel().tolist(), "c": int(model.body(b).name in accent)} for b in bodies],
        "f": [np.concatenate([np.concatenate([np.round(fr[0][b] * 1000), np.round(fr[1][b] * 1000)]) for b in bodies]).astype(int).tolist()
              for fr in frames],
    }


def coop():
    sys.path.insert(0, os.path.join(REPO, "sim", "mujoco_houses", "src"))
    from unitree_demo.coop_lift import demo_config, build_model, G1Controller, G1UpperBodyController, gait_phase
    cfg = demo_config(); model = build_model(cfg, assisted_grasp=False); data = mujoco.MjData(model)
    legs = [G1Controller(model, cfg, "leader_"), G1Controller(model, cfg, "follower_")]
    upper = [G1UpperBodyController(model, "leader_"), G1UpperBodyController(model, "follower_")]
    for c in legs: c.reset(data)
    for c in upper:
        c.set_carry_pose(); data.qpos[c.joint_qpos] = c.target_q
    mujoco.mj_forward(model, data)
    lead, foll = np.array([0.12, 0, 0], np.float32), np.array([0.12, 0, 0], np.float32)  # coop_lift defaults
    every = max(1, round(1 / (args.fps * cfg.simulation_dt))); frames = []
    for step in range(int(8.0 / cfg.simulation_dt)):
        t = step * cfg.simulation_dt
        lead[0] = foll[0] = 0.12 * (0.8 + 0.2 * min(1.0, t / 1.2))
        if t >= 1.5: lead[1], foll[1] = 0.12, -0.12
        for c in legs: c.apply(data)
        for c in upper: c.apply(data)
        mujoco.mj_step(model, data)
        if step % cfg.control_decimation == 0:
            ph = gait_phase(data); legs[0].update_policy(data, lead, ph); legs[1].update_policy(data, foll, ph)
        if t >= 2.0 and step % every == 0:  # the carry itself, after the lift
            frames.append((data.xpos.copy(), data.xquat.copy()))
    o = frames[0][0][model.body("carry_box").id].copy(); o[2] = 0  # box starts at the origin
    frames = [(p - o, q) for p, q in frames]
    print(f"coop: box end {frames[-1][0][model.body('carry_box').id].round(3)}")
    return pack(model, body_points(model, 45), frames, accent=("carry_box",))


def scripted(xml, pose, seconds):
    model = mujoco.MjModel.from_xml_path(xml); data = mujoco.MjData(model)
    mujoco.mj_resetDataKeyframe(model, data, 0); frames = []
    for i in range(seconds * args.fps):
        pose(data, i / args.fps); mujoco.mj_forward(model, data); frames.append((data.xpos.copy(), data.xquat.copy()))
    return pack(model, body_points(model, 40), frames)


def panda_pose(data, t, T=6.0):
    home = np.array([0, 0, 0, -1.57, 0, 1.57, -0.785]); reach = np.array([0.35, 0.55, 0, -2.0, 0, 2.5, -0.785])
    place = np.array([-0.6, 0.35, 0, -2.2, 0, 2.5, -0.785]); u = (t % T) / T
    s = lambda a, b: 0.5 - 0.5 * math.cos(math.pi * min(max((u - a) / (b - a), 0), 1))
    q = home + (reach - home) * s(0, 0.25); q = q + (place - reach) * s(0.35, 0.65); q = q + (home - place) * s(0.8, 1.0)
    data.qpos[:7] = q; data.qpos[7:9] = 0.04 - 0.035 * (s(0.25, 0.32) - s(0.68, 0.75))


def go2_pose(data, t):  # trot in place; the page moves the body along a path
    ph = 2 * math.pi * 2.0 * t; data.qpos[0] = 0; data.qpos[2] = 0.27 + 0.006 * math.sin(2 * ph)
    for leg, off in enumerate([0, math.pi, math.pi, 0]):
        j = 7 + 3 * leg; data.qpos[j] = 0.0
        data.qpos[j + 1] = 0.9 + 0.3 * math.sin(ph + off); data.qpos[j + 2] = -1.8 + 0.3 * max(0.0, math.sin(ph + off + math.pi / 2))


R = {"coop": coop(),
     "arm": scripted(os.path.join(REPO, "sim/menagerie/franka_emika_panda/scene.xml"), panda_pose, 6),
     "quad": scripted(os.path.join(REPO, "sim/menagerie/unitree_go2/scene.xml"), go2_pose, 1)}
with open(args.out, "w") as f:
    f.write("/* Generated by tools/export_robots.py. Per robot: body points (mm, body frame), frames of body poses (mm, quat x1000). */\n")
    f.write("window.ROBOTS=" + json.dumps(R, separators=(",", ":")) + ";\n")
for k, r in R.items():
    print(k, len(r["bodies"]), "bodies,", sum(len(b["p"]) // 3 for b in r["bodies"]), "points,", r["frames"], "frames")
print(os.path.getsize(args.out) // 1024, "KB ->", args.out)
