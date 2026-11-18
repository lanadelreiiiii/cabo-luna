// mission-04-three-stops.ink — Yara's courier line is under pressure:
// three drops across Cabo Luna, each against its own 60-second clock.
// NEW kind `timed_reach`: a drop missed on the clock fails the job
// (too_slow). Branch after drop 2: fast avenue (Colina Verde) vs quiet
// harbor road (Puerto Luna). Reward $500. Fail: timeout 300s / too_slow.
VAR route = ""
VAR payout = 0
VAR fail_reason = ""

-> start

=== start ===
Yara: "The line is hot today, driver. Three drops, three different corners of the city — and every buyer has a clock." # speaker:yara
Yara: "Meet me at the Plaza del Reloj first. Then drive like the rent is due — because it is." # speaker:yara # objective:meet_yara # objective_text:Meet Yara at the Plaza del Reloj
-> END

=== meet_yara_done ===
Yara: "Three parcels in the trunk. The car is yours — get in and go." # speaker:yara # objective:get_car # objective_text:Get in the car — the clock is running
-> END

=== get_car_done ===
Yara: "Drop one is Torre Alta — sixty seconds from the moment you leave this plaza. The buyers don't wait, and neither do I." # speaker:yara # checkpoint # objective:drop_one # objective_text:Drop 1/3 — Torre Alta, 60s on the clock
-> END

=== drop_one_done ===
Tomas: "One down, El Faro saw the handoff. Two is Mercado Norte — same deal, sixty seconds." # speaker:tomas # checkpoint # objective:drop_two # objective_text:Drop 2/3 — Mercado Norte, 60s on the clock
-> END

=== drop_two_done ===
Yara: "Two down. Last one — your call on the road. The avenue is fast and wide open; the harbor road is quiet but longer." # speaker:yara
* [Take the fast avenue.]
    ~ route = "avenue"
    Yara: "Avenue it is. Colina Verde, sixty seconds — don't clip a patrol car on the way." # speaker:yara
* [Take the quiet harbor road.]
    ~ route = "streets"
    Yara: "Harbor road. Puerto Luna drop, sixty seconds — slower streets, fewer eyes." # speaker:yara
- Yara: "Last drop. Go." # speaker:yara # checkpoint # objective:drop_three # objective_text:Drop 3/3 — 60s on the clock
-> END

=== drop_three_done ===
Yara: "Three drops, three clocks, all beaten. But that last run had a report on it — break their line of sight." # speaker:yara # checkpoint # objective:lose_tail # objective_text:Lose the patrol — stay out of sight
-> END

=== lose_tail_done ===
Tomas: "You shook them. Sit tight till the heat dies — the buyers are already counting your money." # speaker:tomas # checkpoint # objective:wanted_clear # objective_text:Wait until the heat clears
-> END

=== wanted_clear_done ===
Yara: "Quiet streets. Three stops, no misses — the line holds because of you." # speaker:yara
-> complete

=== complete ===
~ payout = 500
Yara: "$500. Fastest courier in Cabo Luna — don't let it go to your head." # speaker:yara # mission_complete # reward:500
-> END

=== failed ===
{ fail_reason == "timeout":
    Yara: "Too slow — the buyers walked and the parcels went back in the trunk. We'll run it another day." # speaker:yara
- else:
    { fail_reason == "too_slow":
        Yara: "You missed the clock on a drop — the buyer was gone before you turned the corner. Speed is the job." # speaker:yara
    - else:
        Yara: "Busted mid-run? The parcels are evidence now. Lay low, driver." # speaker:yara
    }
}
-> END
