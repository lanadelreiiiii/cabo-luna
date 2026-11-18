// mission-02-wrong-place.ink — Tomas flags a grey Solano by the
// fountain: a runner stashed evidence under its seat. The player steals
// it, finds a ledger pointing at the harbor operation, loses the patrol
// that answers the stolen-car report, and delivers the ledger to Yara.
// Objectives: steal_evidence_car (in_vehicle) -> reach_quiet_spot
// (reach) -> inspect_evidence (wait 3s) -> evade_patrol (lose_tail 10s)
// -> deliver_evidence (reach). Branch: main avenue through Torre Alta
// vs back streets through Luna Vieja. Reward $300. Fail: timeout 300s.
VAR route = ""
VAR payout = 0
VAR fail_reason = ""

-> start

=== start ===
Tomas: "Driver — El Faro here. That grey Solano by the fountain? It isn't just a car. I watched a runner stash something under the seat." # speaker:tomas
Tomas: "Steal it. The grey Solano — that's the one with the evidence." # speaker:tomas # objective:steal_evidence_car # objective_text:Steal the grey Solano
-> END

=== steal_evidence_car_done ===
Tomas: "You're in. Now get somewhere quiet — Luna Vieja side streets — and look under the seat." # speaker:tomas # checkpoint # objective:reach_quiet_spot # objective_text:Reach a quiet spot in Luna Vieja
-> END

=== reach_quiet_spot_done ===
Tomas: "Under the seat — a ledger. Names, drops, harbor times. This is the harbor operation's book." # speaker:tomas # objective:inspect_evidence # objective_text:Inspect the ledger — sit still
-> END

=== inspect_evidence_done ===
Tomas: "The ledger points at the harbor — Puerto Luna, night drops. Yara needs this book, but the patrol got the stolen-car report." # speaker:tomas
Tomas: "Lose them first. Ten seconds blind and they lose the trail." # speaker:tomas # checkpoint # objective:evade_patrol # objective_text:Lose the patrol — stay out of sight
-> END

=== evade_patrol_done ===
Tomas: "Clean. Now get the ledger to Yara. Avenue's fast, back streets are quiet." # speaker:tomas
* [Main avenue through Torre Alta.]
    ~ route = "avenue"
    Tomas: "Avenue it is. Fast, loud, and right past the towers." # speaker:tomas
* [Back streets through Luna Vieja.]
    ~ route = "streets"
    Tomas: "Back streets. Slow, but the patrol never looks there." # speaker:tomas
- Tomas: "Go — and don't let that ledger out of your hands." # speaker:tomas # checkpoint # objective:deliver_evidence # objective_text:Deliver the ledger to Yara
-> END

=== deliver_evidence_done ===
Yara: "The harbor ledger. Names I know, drops I didn't. You just handed me the whole operation, driver." # speaker:yara
-> complete

=== complete ===
~ payout = 300
Yara: "$300. The wrong car, the right ledger. You're worth more than a fare now." # speaker:yara # mission_complete # reward:300
-> END

=== failed ===
{ fail_reason == "timeout":
    Tomas: "The ledger went cold — the harbor crew moved it. We'll find another way in." # speaker:tomas
- else:
    Yara: "Busted with my ledger? Lay low, driver. The book stays hidden for now." # speaker:yara
}
-> END
