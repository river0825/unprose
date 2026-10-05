# Reading a domain story as a reviewer

What we learned from reviewing a real domain story an agent drew (2026-10-05), checked against the method's own
sources. It is the background for three things: the reviewer's hints in `design lint` (docs/diagrams.md §6b), the
`domain-story` start prompt, and the `critique` start prompt (`/unprose:critique`), which has an agent read a
story and say what to improve.

Sources, and how they are cited here:

- **Book** — Stefan Hofer and Henning Schwentner, *Domain Storytelling* (the Leanpub edition published
  2021-02-27; page numbers are that edition's, and the later Addison-Wesley edition is paged differently).
- **Site** — [domainstorytelling.org/quick-start-guide](https://domainstorytelling.org/quick-start-guide).
- **Egon** — [egon.io/howto](https://egon.io/howto), the authors' modeler.

A reviewer keeps two kinds of statement apart: what **the method says** (the tables below) and **our judgment**
(the section after them). The authors themselves say the language "is more about expressiveness than adherence
to strict rules" (Book p. 34) — so even a rule is a reason to ask, not a verdict.

## What the method says

### Scope

| The method says | What a reviewer does with it |
|---|---|
| Scope = granularity × domain purity × point in time (Book p. 49). | Check that the story states all three. |
| Stories "can be coarse-grained, fine-grained and everything in between"; medium- to fine-grained means "activities have the size of user stories". Modeling "customer clicks button" means "you have probably gone too far" (Book pp. 45–46). | Ask which level the story is at. Coarse: the whole process, where buying a ticket "is just one activity". Fine: that one activity told as a whole story. |
| Goal levels after Cockburn: cloud, kite (summary; takes more than one session), **sea level** (a user goal; one session), fish, clam (Book p. 46). | A handy way to ask "on what level of detail do we need to discuss this?" |
| "Always aim for a consistent level of detail throughout a story. Mixing fine-grained and coarse-grained activities can be considered a 'bad smell'" (Book p. 46). | Sentences that explain how one actor does one thing, inside a coarse-grained story, belong in a story of their own. |
| "We call Domain Stories without software systems pure, and those with software systems we call digitalized" (Book p. 48). | A story with a system actor is digitalized, whatever the scope line says. |
| A typical journey: coarse-grained pure as-is → fine-grained pure as-is → fine-grained digitalized to-be. "Usually it is helpful to omit software systems to see the naked domain itself"; a digitalized to-be story is "often a further development of a pure as-is story". "This is not the only possible journey. Feel free to adapt" (Book pp. 48–50). | Ask what came before this story. A digitalized to-be story with no pure or as-is story behind it is worth a question — not an error. |
| Coarse-grained stories "often illustrate an end-to-end business process"; to see what end-to-end means, add "a few extra sentences at the beginning and at the end" (Book pp. 49–50). | Ask what happens just before sentence 1 and just after the last one. |

### Actors, work objects, icons

| The method says | What a reviewer does with it |
|---|---|
| An actor can be a person, a group of people or a software system; "all actors have in common that they play an active role"; they are labelled with a role, not a person's name (Book p. 20). "Every actor appears only once" (Book p. 26). | Ask of each actor: does it act? |
| "Depending on the context, the concepts of a domain can be modeled as actors or work objects" — a smartphone is a work object as a ticket wallet, an actor when its app notifies people (Book p. 21). | Whether something is an actor is a question about this story, not a fact about the thing. |
| "Actors create, work with, and exchange work objects such as documents, physical things, and digital objects"; an icon may stand for the thing, its digital form, or the medium it travels in (Book pp. 20–21). "Actors and work objects are nouns, activities are verbs" (Book p. 22). | A work object is a noun: a thing. |
| "For every activity, we draw a separate work object (even if the same work object already exists in a previous sentence)" — the ticket "is bought, shown to the user and checked". "As the story evolves, a work object may change its status or representation" (Book p. 26; reasons on p. 34). | The same thing is drawn again each time, under the same name; its state or its icon may change. Follow the main work object through the story. |
| "Make work objects explicit": not hidden in an activity ("searches for available seat in") and not inside another work object (Book pp. 34–35). | Look for nouns of the domain inside verbs. |
| "An icon set should be adapted to the domain" (a container icon in logistics). "Using too many different icons will water down your pictographic language"; "the icons should convey meaning and make the Domain Story more tangible" (Book p. 21). Do not use the same icon for actors and work objects (Book p. 35). Egon: "upload your own icons". | One icon for every work object says nothing; a small set that fits the domain does (`icons:` in the file). |
| "Provide a label for every building block … we prefer readability over brevity" (Book p. 35). | Nothing unnamed. |

### Sentences and the story

| The method says | What a reviewer does with it |
|---|---|
| "Every sentence starts with an actor who initiates an activity: who does what with what with whom"; an actor may also work on a work object alone (Book pp. 31–32). | Each sentence: who starts it? |
| "Keep in mind that you should be able to read the sentence out loud" (Book p. 33). | Read every sentence aloud, in the domain's words. |
| "Avoid technical 'request and response' pattern": it "does not tell a compelling story"; a user interface is better designed with "mock-ups and prototypes". "Use Domain Storytelling to model intent: What is the goal of the user? How does the software system help him to reach that goal? Each activity should push the story forward" (Book pp. 36–37). | A story in which a user and a system answer each other sentence after sentence is a screen flow. Ask for the intent. |
| "Avoid 'loopbacks'": arrows are not a data flow; a system that calculates a price is one activity (Book p. 36). | No arrows from a system back to itself. |
| "There are no symbols for conditionals, variations, or alternatives. They were intentionally left out"; the important alternatives are each "an individual Domain Story, told from beginning to end" (Book pp. 30–31). | No "if" / "or". Variations go into annotations. |
| Annotations "document assumptions, variations, purpose"; about the whole story: "What is the story about? Why is it relevant? Which events trigger the story?" (Book p. 23). | The trigger, the purpose and the assumptions should be written down next to the story. |
| Parallel activities (one number twice) should be used "cautiously because it 'weakens' the story" (Book p. 22). | Ask for an exemplary order. |
| Synonyms and homonyms: do not invent "an artificial language"; annotate them in coarse-grained stories and work out an unambiguous language per sub-domain in detailed stories (Book ch. 9). | Two names for one thing inside one story is a finding; across sub-domains it may be how people really talk — annotate it. |
| "When the story seems to be finished, then tell the story from the beginning and try to get agreement: Did we miss something? Is something obviously wrong?" (Book p. 72). | Always do it — most findings show up here. |

## Our judgment (say so when you use it)

- **An outcome is not a work object.** "Validation passed" or "Assigned to A only" names what happened; the
  book only says work objects are nouns. Name the thing ("validation result", "assignment") and keep the
  outcome in the verb or a note. A state *on* a thing is fine ("signed contract") — the book says a work object
  may change its status.
- **Active or carried along?** Something that is brought in, checked and routed (a lead, an order) is often the
  work object, and the actor is whoever sends it. The book leaves this to the context, so ask.
- **A system talking to itself.** Several sentences in a row where a system acts and nobody receives anything
  are grammatical, but usually a finer level of detail than the rest of the story.
- **An ending.** A story that stops at "reviews" has not said what anyone does with the result. If that is
  undecided, a note should say so.

## Where we were wrong at first

Worth keeping, because an agent reviewing a story will be tempted the same way:

- We read "every activity gets its own work object" as a drawing workaround. It is the method's rule; what the
  story lacked was the *same name* on the repeated object, not fewer objects.
- We called every state-like label a mistake. Only a bare outcome is questionable.
- We first stated "this is a screen flow, not a domain story" and "tell it pure and as-is first" as rules
  without a source; then, after reading only the site, withdrew them as mere judgment. The book has both — the
  first as poor style, the second as the typical journey, explicitly not a strict rule. The lesson is about the
  reviewer, not the story: say where a claim comes from, and say "I have not checked" when that is the case.

## How to give the review

1. Look before judging: the sentences (`canvas_read_board` with the frame), the picture (`canvas_snapshot`),
   the lint hints.
2. Say what the story says, then what is well done — a concrete case, evidence and open questions kept apart
   from decisions, a sensible split into scenarios.
3. Findings, most important first. Each one: the sentence number, a **question** for the people who know the
   domain, and a rewritten sentence. A reviewer who does not know the domain asks; guesses are not findings.
4. Mark each finding "the method says" (with the source) or "my judgment".
5. Close with the three changes to make first. Do not edit the file; whoever holds it applies what the person
   agrees to.

A finding is easiest to take when it sits on the sentence it is about, as one question — not in a list of nine.

## What lint can and cannot see

Lint sees the file, so it can tell: the scope is not stated; `pure` with a system actor; every sentence between
one user and one system; "if" / "or" in a sentence; a label ending in an outcome word; no work object repeated;
one icon for everything; a kind without an icon. All of these are `info` (the scope contradiction is a
warning): questions for the conversation. Lint cannot tell whether an actor really acts, whether the levels of
detail are mixed, or whether the story has an ending — that is what the `critique` prompt is for.
