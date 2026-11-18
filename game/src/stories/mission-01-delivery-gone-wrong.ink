// mission-01-delivery-gone-wrong.ink — Yara Delgado hires the player for
// a simple delivery at Plaza del Reloj. The parcel turns out to be
// contraband: a stash parcel moving through her courier line.
// Objectives: meet_yara (reach) -> get_car (in_vehicle) ->
// deliver_parcel (reach) -> lose_tail (8s) -> wanted_clear.
// Branch at the delivery: open the parcel (+$50, more heat via a
// # crime tag) vs deliver it sealed (clean $150). Fail: timeout 240s.
VAR parcel_open = ""
VAR payout = 0
VAR fail_reason = ""

-> start

=== start ===
Yara: "You must be the new driver. I'm Yara — I run courier work out of Mercado Norte, and I pay on time." # speaker:yara
Yara: "First job is simple. Meet me right here, at the Plaza del Reloj — then we'll talk." # speaker:yara # objective:meet_yara # objective_text:Meet Yara at the Plaza del Reloj
-> END

=== meet_yara_done ===
Yara: "There you are. The parcel's in the trunk of the yellow Brisa by the fountain. Get in the car." # speaker:yara # objective:get_car # objective_text:Get in the car
-> END

=== get_car_done ===
Yara: "Good. Now drive it to the Mercado Norte drop — stall twelve, ask for no one, leave it and go." # speaker:yara # checkpoint # objective:deliver_parcel # objective_text:Deliver the parcel to Mercado Norte
-> END

=== deliver_parcel_done ===
Yara: "Wait — the seal's wrong. This isn't flour or fabric. That's a stash parcel — someone's moving product through my courier line." # speaker:yara
Yara: "Your call, driver. Open it and we learn what's inside — but the patrol watches opened freight. Or deliver it sealed and stay clean." # speaker:yara
* [Open the parcel.]
    ~ parcel_open = "open"
    ~ payout = 200
    Yara: "Ledger pages and wrapped bricks. Now we know — and now they know we know. Move." # speaker:yara # crime:theft
* [Deliver it sealed.]
    ~ parcel_open = "sealed"
    ~ payout = 150
    Yara: "Sealed it is. Clean hands, clean pay." # speaker:yara
- Yara: "The patrol's already rolling — that stolen car has a report on it. Break their line of sight." # speaker:yara # checkpoint # objective:lose_tail # objective_text:Lose the patrol — stay out of sight
-> END

=== lose_tail_done ===
Tomas: "You shook them — for now. El Faro sees everything from the docks. Sit tight till the heat dies." # speaker:tomas # checkpoint # objective:wanted_clear # objective_text:Wait until the heat clears
-> END

=== wanted_clear_done ===
Yara: "Quiet streets. First job, first heat, and you're still free. You're on my board now, driver." # speaker:yara
-> complete

=== complete ===
Yara: "Pay's in your pocket. Welcome to the real Cabo Luna." # speaker:yara # mission_complete
-> END

=== failed ===
{ fail_reason == "timeout":
    Yara: "Too slow — the drop went cold and the buyer walked. We'll run it another day." # speaker:yara
- else:
    Yara: "Busted on your first run? Lay low, driver. The board waits." # speaker:yara
}
-> END
