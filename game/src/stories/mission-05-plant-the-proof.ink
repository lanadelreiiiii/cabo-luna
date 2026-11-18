// mission-05-plant-the-proof.ink — Yara flips the operation's own game:
// plant forged ledger pages in their Torre Alta office, so their own
// courier line gets raided. The plant itself is the crime (# crime tag
// on plant_done): the heat, the witnesses and the district response
// arrive AFTER the quiet part, so the escape is a real chase — the
// garage is the getaway. Two guards patrol the office: a threat, not
// a target. Branch: smash the alarm (+$100, +25 heat) vs slip out
// quiet ($550 clean). Reward $550/$650. Fail: timeout 360s.
VAR payout = 0
VAR fail_reason = ""
VAR alarm = ""

-> start

=== start ===
Yara: "The operation keeps its real ledger in a Torre Alta office — and their own people trust whatever's filed there. So we're going to file something." # speaker:yara
Yara: "Forged pages, their courier's handwriting, their routes. Get inside on foot, plant them, and walk away. Quiet — until it isn't." # speaker:yara # objective:infiltrate_office # objective_text:Reach the Torre Alta office on foot
-> END

=== infiltrate_office_done ===
Tomas: "You're in. Two guards on the floor — they patrol, they don't stare. The desk is yours for four seconds. Plant it and don't touch anything else." # speaker:tomas # objective:plant_evidence # objective_text:Plant the ledger pages — hold still
-> END

=== plant_evidence_done ===
Tomas: "Pages are in. But the office alarm is live — the moment their system sweeps the file, this whole block lights up." # speaker:tomas
Tomas: "Your call. Smash the alarm box on your way out — buys you confusion, but the noise brings heat. Or slip out quiet and let the pages do the work." # speaker:tomas
* [Smash the alarm.]
    ~ alarm = "smashed"
    ~ payout = 650
    Tomas: "Alarm's dead — and so is quiet. The whole district just heard that. Run." # speaker:tomas # crime:sabotage
* [Slip out quiet.]
    ~ alarm = "quiet"
    ~ payout = 550
    Tomas: "Quiet it is. The pages will detonate on their own schedule — not yours." # speaker:tomas
- Yara: "It's done — the file is planted and their own system will read it back to them. Now vanish. Taller Brisa garage, Luna Vieja — lose the trail inside." # speaker:yara # checkpoint # crime:theft # objective:escape_garage # objective_text:Reach the Taller Brisa garage — lose the trail
-> END

=== escape_garage_done ===
Yara: "Inside the garage. The trail ends here — their witnesses saw a car that doesn't exist anymore." # speaker:yara # checkpoint # objective:wanted_clear # objective_text:Wait until the heat clears
-> END

=== wanted_clear_done ===
Yara: "Quiet streets. By morning their own ledger will hang their own courier — and they'll never know it was us." # speaker:yara
-> complete

=== complete ===
Yara: "Pay's in your pocket. The operation just framed itself." # speaker:yara # mission_complete
-> END

=== failed ===
{ fail_reason == "timeout":
    Yara: "Too slow — the office swept its files before the pages went in. The forgery is worthless now." # speaker:yara
- else:
    Tomas: "They got you in the office. The pages never made the file — El Faro will come for the car." # speaker:tomas
}
-> END
