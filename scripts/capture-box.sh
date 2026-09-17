#!/bin/bash
# Draw a box with slurp, float the focused window into it, and remember the layout.

set -euo pipefail

STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/omarchy/omafloat"
STATE_FILE="$STATE_DIR/positions.json"
mkdir -p "$STATE_DIR"

notify() {
  omarchy-notification-send -u low -g "󰗡" "OmaFloat" "$1" >/dev/null 2>&1 || true
}

# Toggle-off if a previous picker is still up.
if pgrep -x slurp >/dev/null 2>&1; then
  pkill -x slurp >/dev/null 2>&1 || true
  notify "Capture cancelled"
  exit 0
fi

ACTIVE=$(hyprctl -j activewindow 2>/dev/null || true)
ADDR=$(jq -r '.address // empty' <<<"$ACTIVE")
KEY=$(jq -r '[.initialClass, .class] | map(select(. != null and . != "")) | first // empty' <<<"$ACTIVE")
FLOATING=$(jq -r '.floating // false' <<<"$ACTIVE")
PINNED=$(jq -r '.pinned // false' <<<"$ACTIVE")

if [[ -z $ADDR || -z $KEY ]]; then
  notify "No focused window to capture"
  exit 1
fi

# Only accept Hyprland hex addresses — never interpolate arbitrary strings into dispatch.
if [[ $ADDR =~ ^0x[0-9a-fA-F]+$ ]]; then
  :
elif [[ $ADDR =~ ^[0-9a-fA-F]+$ ]]; then
  ADDR="0x$ADDR"
else
  notify "Invalid window address"
  exit 1
fi

notify "Draw a box for the float layout"
# Let the notification paint before slurp grabs the pointer.
sleep 0.15

BOX=$(slurp -d -f '%x,%y %wx%h' 2>/dev/null || true)
if [[ -z ${BOX:-} ]]; then
  notify "Capture cancelled"
  exit 0
fi

if [[ ! $BOX =~ ^(-?[0-9]+),(-?[0-9]+)[[:space:]]([0-9]+)x([0-9]+)$ ]]; then
  notify "Could not read the drawn box"
  exit 1
fi

X="${BASH_REMATCH[1]}"
Y="${BASH_REMATCH[2]}"
W="${BASH_REMATCH[3]}"
H="${BASH_REMATCH[4]}"
WINDOW="address:$ADDR"

hypr_dispatch() {
  local lua="$1"
  shift
  hyprctl dispatch "$lua" >/dev/null 2>&1 || hyprctl dispatch "$@" >/dev/null
}

if [[ $FLOATING != "true" ]]; then
  hypr_dispatch "hl.dsp.window.float({ window = \"$WINDOW\", action = \"set\" })" setfloating "$WINDOW"
fi

hypr_dispatch "hl.dsp.window.resize({ window = \"$WINDOW\", x = $W, y = $H })" resizewindowpixel exact "$W" "$H" "$WINDOW"
hypr_dispatch "hl.dsp.window.move({ window = \"$WINDOW\", x = $X, y = $Y })" movewindowpixel exact "$X" "$Y" "$WINDOW"

# Persist monitor-relative geometry so restore survives reboot / monitor moves.
python3 - "$STATE_FILE" "$KEY" "$X" "$Y" "$W" "$H" "$PINNED" <<'PY'
import json, sys, time
from pathlib import Path

state_path = Path(sys.argv[1])
key, gx, gy, w, h = sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6])
pinned = sys.argv[7].lower() == "true"

import subprocess
mons = json.loads(subprocess.check_output(["hyprctl", "-j", "monitors"], text=True))

def logical_size(m):
    scale = float(m.get("scale") or 1) or 1
    return int(m.get("width", 1920) / scale), int(m.get("height", 1080) / scale)

monitor = None
for m in mons:
    mx, my = int(m.get("x") or 0), int(m.get("y") or 0)
    mw, mh = logical_size(m)
    if mx <= gx < mx + mw and my <= gy < my + mh:
        monitor = m
        break
if monitor is None:
    monitor = next((m for m in mons if m.get("focused")), mons[0] if mons else None)

mon_name = monitor.get("name", "") if monitor else ""
mx = int(monitor.get("x") or 0) if monitor else 0
my = int(monitor.get("y") or 0) if monitor else 0

store = {"version": 1, "positions": {}}
if state_path.exists():
    try:
        store = json.loads(state_path.read_text())
        if not isinstance(store, dict):
            store = {"version": 1, "positions": {}}
        store.setdefault("positions", {})
    except Exception:
        store = {"version": 1, "positions": {}}

store["positions"][key] = {
    "monitor": mon_name,
    "x": gx - mx,
    "y": gy - my,
    "w": max(1, w),
    "h": max(1, h),
    "pinned": pinned,
    "updatedAt": int(time.time()),
}
state_path.parent.mkdir(parents=True, exist_ok=True)
tmp = state_path.with_suffix(".tmp")
tmp.write_text(json.dumps(store, indent=2) + "\n")
tmp.replace(state_path)
print(key)
PY

notify "Saved safe layout for $KEY"
