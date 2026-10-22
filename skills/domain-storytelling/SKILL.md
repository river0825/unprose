---
name: domain-storytelling
description: Write, draw or review a Domain Story the way the method's authors do (Hofer & Schwentner, Domain Storytelling) — one concrete scenario of who does what with what, told with the person, not guessed. Use when asked to tell a process as a domain story, to review or critique one, to decide whether a domain story (or EventStorming, a story map, a note) fits some content, or whenever a design/*.domain-story.yaml file is written or drawn. Works with Unprose (design_lint / design_draw / the critique prompt) and without it.
---

# Domain Storytelling — the method, where you need it

A domain story shows **who does what with what, and hands it to whom**, in **one concrete case**, as sentences the
person would say aloud. It is told *with* the people who do the work; you record it, you do not invent it.

Everything here rests on the authors' book (Stefan Hofer & Henning Schwentner, *Domain Storytelling*, Leanpub
edition of 2021-02-27 — page numbers are that edition's) and their site, domainstorytelling.org. `references/method.md`
has the rules chapter by chapter with pages; `references/examples.md` the good / bad pairs; `references/checklists.md`
the questions to ask before, while and after; `references/icons.md` how to draw icons for the domain, with a gallery
(ours). When a claim below is ours, not theirs, it says so.

## 1. Is a domain story the right diagram?

Ask what shape the content has before you pick a kind (the book, p. 69: use the method when it helps the goal, not
"because it has been useful before"):

| The content is… | Use |
|---|---|
| one concrete case of people (and systems) cooperating — who does what, hands what to whom | **a domain story** |
| what happens over time, how a system reacts, status changes, *what does not happen and why* | EventStorming (events, policies, hotspots) — the book itself sends time-and-status content there (p. 80) |
| a rule or an invariant ("only once per contact"), a comparison, a decision | a policy / hotspot / definition sticky, a story map's acceptance, a decisions list — **not a story** |
| how a screen looks and reacts | a mock-up (p. 37) |
| scope and order of delivery | a story map (p. 81) |

Two stories that only differ in what does *not* happen are not two stories. A story made of "checks… checks… (nothing
is sent)" has no plot: every activity must push the story forward (p. 37).

## 2. Before you draw — settle the scope and the case

1. **Scope** = granularity × purity × time (p. 49). Say all three and keep every sentence at that level:
   - *coarse-grained* (kite / cloud): the whole process at a glance — "buying a ticket is just one activity";
     *fine-grained* (sea level, one session, one user goal): that one activity told as a whole story; *medium* between.
     "Customer clicks button" is too fine for any story (p. 46). Mixing levels is a "bad smell" (p. 46).
   - *pure* (no software systems) or *digitalized* (systems are actors) (p. 48). *as-is* or *to-be* (p. 47).
   - The typical journey: coarse pure as-is → fine pure as-is → fine digitalized to-be; "not the only possible journey"
     (pp. 49–50). Ask what came before this story; a digitalized to-be story with nothing behind it is a question.
2. **One case.** Start with "the 80% case, the happy path" (p. 40); "assuming that…, what do you do next?" Write the
   assumptions down. An important variation (sold out, conflict found) is **its own story**, often a copy of the happy
   path up to the sentence where it differs, annotated there (pp. 41–42). Small variations are annotations, not stories.
   When there is no typical case, take three past cases of rising complexity (p. 43).
3. **Who tells it.** Real experts "from the trenches", not proxies (p. 64). You are the moderator-modeler: you ask
   "what happens next? where do you get this information? how do you determine what to do next? how do you do
   that?" (p. 67) and record what they say. An actor or a purpose you guessed is a question, not a sentence.

## 3. The language (chapter 2)

- **Actors** — a person, a group or a software system that "plays an active role" (p. 20); named by role, not by a
  person's name (unless two people do it differently and you want to show that, p. 69); **each actor once** (p. 26) — declared once in the file; when a long story keeps coming back to an early actor and its arrows cross the picture, `layout: { actors: repeat }` lets the board draw that actor again where the story continues, and `drawAgain: <actor>` on a sentence draws it again for that sentence, next to it, when a line still runs across the board the person arranged (docs/diagrams.md §6b "Repeated actors").
  The same concept can be an actor in one story and a work object in another (a smartphone, p. 21) — ask.
- **Work objects** — what actors "create, work with, and exchange": documents, physical things, digital objects, or
  the information about them; the icon may show the thing, its digital form or the medium (pp. 20–21). Nouns (p. 22).
  **Every activity gets its own work object, even if the same one appeared before** (p. 26): the ticket "is bought,
  shown and checked". The same thing keeps the **same name**; its state or icon may change ("signed contract").
- **Activities** — arrows labelled with verbs of the domain language; numbered at the arrow's origin; one number per
  activity, a shared number only for things that truly happen at once ("use this special case cautiously", p. 22).
- **A sentence** — "who does what with what with whom"; subject – predicate – object; it may have a second object
  ("works on w to edit v") or several recipients, or two actors collaborating on one object (pp. 31–33). "Keep in mind
  that you should be able to read the sentence out loud" (p. 33).
- **Annotations** — assumptions, variations, purpose, pain points, domain terms; about one sentence (reference it by
  number) or about the whole story: what it is about, why it matters, what triggers it (p. 23). Where what does *not*
  happen goes: the case told → an assumption on the whole story; a sentence that would not happen → a variation note
  on that sentence; a stretch sometimes skipped → an optional **group** (p. 28); the rule itself → EventStorming
  policy or the story map's acceptance.
- **Groups** — outlines for repeated or optional parts, locations, organisations, sub-domains (p. 28).
- **Icons** — a set "adapted to the domain" (a container icon in logistics); not too many ("water down the language"),
  different for actors and work objects (pp. 21, 35). Draw the domain's own ([references/icons.md](references/icons.md)).
- **No conditionals.** "There are no symbols for conditionals, variations, or alternatives. They were intentionally
  left out" (p. 30). No "if", "or", "sometimes", "does not".

## 4. Good style — the authors' do's and don'ts (pp. 34–38)

| Do | Don't |
|---|---|
| give every sentence its own work object | reuse one pictogram with arrows in and out |
| make the work object explicit: *cashier searches for* **seat** *in* **seating plan** | hide it in the verb ("searches for available seat in") or in another object |
| label every actor, activity, work object, group | leave "obvious" things unnamed ("we prefer readability over brevity") |
| a system acting alone is one sentence: *system calculates price* | a "loopback" arrow from the system back to itself (arrows are not data flow) |
| model intent: what is the user after, how does the system help, each activity pushes the story | the technical request / response pattern between a user and a system — "it does not tell a compelling story"; a UI is a mock-up's job |
| keep the level of detail consistent | mix coarse and fine sentences |
| 10 sentences on a flipchart, 15 on a whiteboard, 20 in a tool (p. 70) | a 30-sentence story — split it |

## 5. While and after — the moderator's checks (chapter 6)

- Re-tell each sentence as you record it; ask "is this the right term?" (p. 67). Introduce an icon when it first appears.
- Watch for **plot holes**: parts not connected by arrows — "how does the usher get the ticket?" (p. 68). Ask: who does
  this? how do they know to do it now? how do the actors communicate?
- Pain points ("this goes wrong all the time") are not part of the story but worth a differently coloured note (p. 68).
- Stuck? Replace the beginning with an assumption; one storyline only; do not mix as-is and to-be; park objections and
  ideas as annotations (p. 69). People disagree? Name the actors after the people and compare (p. 69).
- **Finishing:** "tell the story from the beginning and try to get agreement: did we miss something? is something
  obviously wrong? do all domain experts agree?" Then revisit the annotations: which variations deserve a story of
  their own (p. 72)?

## 6. Reviewing a story someone else drew

Read the sentences, look at the picture, run the grammar check if you have one — then **tell the story back to
yourself from the beginning** and hold it against sections 1–5. Report in this order: what the story says (2–3
sentences); what is well done; findings most important first, each with the sentence number, **the question to ask
the people who know the domain**, a rewritten sentence, and whether the method states it (cite the page) or it is your
judgment; the three changes to make first. A reviewer who does not know the domain asks — a guess is not a finding.
You advise; whoever holds the file changes it after the person agrees.

## 7. What agents get wrong (seen in real boards)

1. **Drawing a rule as a story** — a timeline of "checks… not sent… checks… not sent". The content was a policy and an
   acceptance criterion; the story had no plot. → section 1.
2. **A screen flow as a story** — user asks, system answers, user clicks. → model intent; the UI is a mock-up.
3. **Three names for one thing** ("Casey plan=free", "Casey plan=growth", "Casey new name"). → same name, state in a note.
4. **Dates in verbs** ("10/1 imports"). → the numbers say what comes first; the when is a note. (Our judgment.)
5. **A guessed actor drawn as fact** ("operations changes the plan" — nobody said so). → ask; until then a note.
6. **Letting the layout decide the model** — an actor dropped so the picture fits. → change spacing or split into
   scenarios; never the story.
7. **Trusting "0 lint notes"** — the grammar check cannot see a wrong diagram or a false story. → tell it back.
8. **Over-correcting "a system talking to itself"** — the key sentence (*system assigns lead to cadence A*) deleted
   with the chatter. A system acting on a work object is a fine sentence (p. 36); keep the one that moves the story.

## With Unprose

`design/<name>.domain-story.yaml` (docs/diagrams.md §6b): `scope`, `actors`, `workObjects`, numbered `sentences`
(`actor`, `verb`, `object`, `to`, `toLabel`, `note`, `drawAgain`), `groups`, `annotations`, `icons` of your own. A note is named after
what it is on; give a second note on the same element an `id`, so adding a note never moves another on the board.
**Draw icons for the domain's things.** The built-in work-object icons (document, thing, digital, folder, call, email,
conversation, info) are generic, and a work object without a `kind` is a document; when most of a story's things
look alike the picture stops telling them apart. Declare the work objects, draw an icon for each kind of thing that
matters — the main work object first — under `icons:` (a 24 × 24 outline of plain shapes) and use its name as the
`kind`. [references/icons.md](references/icons.md): when, how, and a gallery to copy from. `design_lint` checks
grammar and drawing and asks reviewer's questions; its result ends with the story read back. `design_draw` draws it;
collisions are a layout problem (`layout.spacing`, groups, a split) — never the story. `/unprose:domain-story` tells a
story with the person; `/unprose:critique` reviews one; `design_propose_stories` turns sentences by people into
story-map candidates the way the book's recipe does (one requirement per activity to be supported, pp. 149–150).
