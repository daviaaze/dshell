from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from check_compositor_render import missing_from_render

SEED = {
    "windowRules": [
        {"id": "render-unfocused-chiaki", "match": {"class": "^chiaki-ng$"}, "effects": {"render_unfocused": True}, "enabled": True},
        {"id": "float-share-picker", "match": {"class": "^x$"}, "effects": {"float": True}, "enabled": True},
        {"id": "disabled-rule", "match": {}, "effects": {}, "enabled": False},
    ],
    "layerRules": [{"match": {"namespace": "^shade-bar$"}, "effects": {"blur": True}, "enabled": True}],
    "settings": {"misc": {"render_unfocused_fps": 30}, "general": {"gaps_in": 2}, "env": ["A,b"]},
}

CURRENT = (
    'hl.config({["misc"] = {["render_unfocused_fps"] = 30}, ["general"] = {["gaps_in"] = 2}})\n'
    'hl.window_rule({name="render-unfocused-chiaki", match={["class"] = "^chiaki-ng$"}, render_unfocused=true})\n'
    'hl.window_rule({name="float-share-picker", match={["class"] = "^x$"}, float=true})\n'
    'hl.layer_rule({match={["namespace"] = "^shade-bar$"}, blur=true})\n'
)


class RenderFreshnessTests(unittest.TestCase):
    def test_current_render_has_nothing_missing(self):
        self.assertEqual(missing_from_render(SEED, CURRENT), [])

    def test_render_from_before_a_rebuild_lists_the_new_rules_and_settings(self):
        stale = (
            'hl.config({["misc"] = {}, ["general"] = {["gaps_in"] = 2}})\n'
            'hl.window_rule({name="float-share-picker", match={["class"] = "^x$"}, float=true})\n'
            'hl.layer_rule({match={["namespace"] = "^shade-bar$"}, blur=true})\n'
        )
        self.assertEqual(
            missing_from_render(SEED, stale),
            ["window rule render-unfocused-chiaki", "setting misc.render_unfocused_fps"],
        )

    def test_disabled_rules_are_not_required_in_the_render(self):
        self.assertNotIn("window rule disabled-rule", missing_from_render(SEED, CURRENT))

    def test_missing_layer_rule_effect_is_reported(self):
        lua = CURRENT.replace("blur=true", "")
        self.assertEqual(missing_from_render(SEED, lua), ["layer rule effect blur"])


if __name__ == "__main__":
    unittest.main()
