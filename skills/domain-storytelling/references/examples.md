# Examples — good and bad, side by side

The book's own examples are the Metropolis cinema (chapters 1–7) and Alphorn car leasing (part two). The others
below come from real boards agents drew in 2026, with the domain words changed.

## Sentences

| Don't | Do | Why |
|---|---|---|
| *Cashier searches for available seat in seating plan* (seat inside the verb) | *Cashier searches for **seat** in **seating plan*** | the seat is a domain concept; make it a work object (pp. 34–35) |
| *System* → *price* → *system* (loopback) | *System calculates price* | arrows are not data flow (p. 36) |
| *User requests ticket list* → *System returns ticket list* → *User clicks buy* → *System responds…* | *Movie-goer picks seats in the app; app reserves seats; movie-goer pays ticket; app issues ticket to movie-goer* | model intent, not request/response (pp. 36–37); "clicks" is too fine (p. 46) |
| *Operator submits experiment to system* → *System provides check result to operator* → *Operator enables experiment* | *System checks experiment against running flows* → *Operator enables experiment* | the request/response pair becomes one sentence; the thing being protected (running flows) becomes visible |
| *Contact Loop returns **validation passed*** | *Contact Loop returns **check result*** (note: passed in this case) | a work object is a thing, not an outcome (ours) |
| *Lead enters via entry trigger into system* (the lead as actor) | *Lead source sends **lead record** to system* | the lead is carried along; whoever sends it acts (p. 20; ours for this case) |
| *Ops 10/1 imports Casey plan=free* | *Client system imports **Casey's contact*** (note: 10/1, plan = free) | the number says what comes first; the state is a note (ours) |
| *Casey plan=free*, *Casey plan=growth*, *Casey new name* (three work objects) | ***Casey's contact*** three times, state in notes | one thing, one name; its state may change (p. 26) |
| *Decision role — OPEN records · OPEN next-step record* | *Decision role records **next-step record*** + annotation "OPEN: who decides, by what rule" | labels are domain words; assumptions are annotations (pp. 20, 23); read it aloud (p. 33) |
| *System checks ledger* (not sent) → *System checks ledger* (not sent) | no story — a policy "when a contact matches, send once per contact" + a hotspot "leaves and returns" | each activity pushes the story forward (p. 37); what does not happen is a rule, not a plot |

## Where what does not happen goes

| To say | Put it |
|---|---|
| which case this story tells ("Casey matches for the first time") | an annotation on the whole story: *Assumption: …* (p. 23; pp. 41–42) |
| where a sentence would not happen ("already sent → ③ does not happen") | an annotation on that sentence: *Variation: …*, the detail in the sentence's note |
| a stretch that is sometimes skipped | a group outline around it, labelled *optional: …* (p. 28) |
| an alternative that ends differently and matters (sold out; conflict found) | its own story, copied from the happy path up to the differing sentence (pp. 41–42) |
| the rule itself ("only once per contact") | an EventStorming policy / hotspot, or a story map's acceptance; the story links to it |
| a rejected alternative | the decisions list; the story keeps one link |

## A story and its variation (the book's shape, pp. 41–42)

**Ticket sales (happy path):** ① movie-goer asks cashier for seats; ② cashier searches for seats in seating plan; ③
cashier suggests seats to movie-goer; ④ movie-goer accepts; ⑤ cashier books ticket; ⑥ cashier hands ticket to
movie-goer. *Assumptions: enough seats; the movie-goer likes the seats offered; no subscription.*

**Ticket sales, show sold out:** ①–② as above; ② annotated *Assumption: no seats available*; ③ cashier tells
movie-goer the show is sold out; ④ cashier suggests another show time … — a different plot from ③ on, told to its end.

## Scope in practice

| Content | Scope | Why |
|---|---|---|
| from "customer wants a car" to "customer drives off" across sales, risk, service | coarse-grained · as-is · pure | an overview; the anchor for the fine stories; the input for finding sub-domains (ch. 10) |
| how a risk manager assesses one contract today | fine-grained · as-is · pure | one sub-domain, one session, the words people use |
| how the cashier will sell a ticket with the new box-office app | fine-grained · to-be · digitalized | the sentences the app must support are its first requirements (p. 52) |
| an operator sets up an A/B experiment in a tool, six sentences, one session | fine-grained (not coarse: it is one user goal) | the board had it labelled coarse; the coarse story — from "we want to compare two cadences" to "we decided" — did not exist yet |

## Icons

A small set that fits the domain: in the cinema — movie-goer, cashier, usher; ticket, seating plan, seat, show. In
logistics — a container. Too many icons water the language down (p. 21); one generic icon for everything says nothing.
Never the same icon for an actor and a work object (p. 35).

| Don't | Do | Why |
|---|---|---|
| reminder, invoice, contract, payment record — all the document icon (no `kind`, or `kind: document` everywhere) | `icons:` with `reminder` (a bell), `invoice` (a receipt), `contract` (a signed page), `payment` (a banknote); the work objects declared with those kinds ([icons.md](icons.md)) | icons "convey meaning and make the Domain Story more tangible" (p. 21); four alike tell nothing apart |
