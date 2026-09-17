-- OmaFloat: draw a box to set float position + size, then remember it.
-- Merge into ~/.config/hypr/bindings.lua, then: hyprctl reload && hyprctl configerrors
--
-- Super+Alt+O starts capture (Super+O remains pop-out & pin).
-- Leaves Super+Shift+O (Obsidian) and Super+Ctrl+O (Toggle menu) alone.

o.bind(
  "SUPER + ALT + O",
  "OmaFloat capture",
  "bash " .. (os.getenv("HOME") or "") .. "/.config/omarchy/plugins/agileautomation.omafloat/scripts/capture-box.sh"
)
