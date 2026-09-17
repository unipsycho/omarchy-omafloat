-- OmaFloat: draw a box to set float position + size, then remember it.
-- Merge into ~/.config/hypr/bindings.lua, then: hyprctl reload && hyprctl configerrors
--
-- Super+Shift+O starts capture (Super+O remains pop-out & pin).
-- Stock Super+Shift+O was Obsidian — unbind it first.

hl.unbind("SUPER + SHIFT + O")
o.bind(
  "SUPER + SHIFT + O",
  "OmaFloat capture",
  "bash " .. (os.getenv("HOME") or "") .. "/.config/omarchy/plugins/agileautomation.omafloat/scripts/capture-box.sh"
)
