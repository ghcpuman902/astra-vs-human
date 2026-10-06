# mini-game-rules

Reusable rules for agents translating future game plans into game interfaces; not the hackathon shell.

- Never hide rules in a dropdown or modal.
- Each click immediately places or alternates a piece: empty → first → second → first; no focus-only click or third empty state.
- Do not explain generic empty or all-filled completion. Explain a winning criterion only if an unstriped partial or filled board can still be non-winning.
- Keep empty cells neutral; stripe actual wrong moves only. Complete success automatically; fail only after explicit give-up/next.
- Fixed initial pieces have no lock icon and no hover movement. Reject clicks with a short shake and a static outline; respect reduced motion. Editable cells have a hover cue.
- Choose distinct, easily named, culturally comparable symbol pairs and categorical fills per game. Sun/moon is an example, not a universal requirement. Never depend on colour alone.
- Share board and explanation cell rendering. Keep examples inline and copy minimal, without repetition or abstract state-mapping prose.
- No agent ghosts or agent-only rules.