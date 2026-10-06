# The method, chapter by chapter

Distilled from Stefan Hofer & Henning Schwentner, *Domain Storytelling* (Leanpub edition published 2021-02-27; the
later Addison-Wesley edition is paged differently) and the authors' site, domainstorytelling.org. Short quotes only;
the rest is paraphrase. "Ours" marks what the book does not say.

Chapters 2, 3, 4, 6, 7, 10 and 12 were read closely; chapters 1, 5, 9, 11 and 13–15 are summarised from their
opening pages and section titles — read the book for those.

## Chapter 1 — What it is (pp. 8–18)

- A collaborative modeling technique: domain experts tell a story, a moderator records it in a pictographic language
  in front of everyone, the picture is read back and corrected on the spot. The picture *and* the conversation are the
  result; the picture alone is a memory aid.
- Three uses the book keeps coming back to: learn the domain language, find boundaries (sub-domains), and move from
  stories to requirements and code.

## Chapter 2 — The pictographic language (pp. 19–38)

| Element | Rule | Page |
|---|---|---|
| Actor | "a person, a group of people, or a software system"; "all actors have in common that they play an active role" | 20 |
| Actor label | the role or function ("cashier"), not the person's name — except deliberately (personas, or two people who work differently) | 20, 69 |
| Actor or work object? | depends on the story: a smartphone is a work object as a ticket wallet, an actor when its app notifies | 21 |
| Work object | "documents, physical things, and digital objects", and information about them; one icon may stand for the thing, its digital representation, or the medium (a phone call) | 20–21 |
| Icon set | "should be adapted to the domain"; "too many different icons will water down your pictographic language"; icons "convey meaning and make the Domain Story more tangible" | 21 |
| Activity | an arrow labelled with a verb from the domain language; "actors and work objects are nouns, activities are verbs" | 22 |
| Sequence | numbers at the arrow's origin express time; every number once; the same number only for parallel activities — "use this special case cautiously because it 'weakens' the story"; two actors working together on one object share a number | 22 |
| Annotations | "assumptions, variations, purpose, and anything else that is noteworthy"; about one sentence (by its number: other cases, optional activities, possible errors, the purpose of an activity) or about the whole story (what, why, trigger, constraints) | 23 |
| Name | the story gets a name that "expresses what's happening", from domain words; company, number, case and scope may be added | 24 |
| Actors once | "Every actor appears only once in the Domain Story. But for every activity, we draw a separate work object (even if the same work object already exists in a previous sentence)" | 26 |
| State | "As the story evolves, a work object may change its status or representation" — seats as a seat icon, then as a speech bubble | 26–27 |
| Groups | an outline for parts that belong together: repeated activities, optional activities, locations, organisational boundaries, sub-domains | 28 |
| Colour | to emphasise, to show differences (versions of a process), as an alternative to groups; add a legend | 30 |
| No conditionals | "There are no symbols for conditionals, variations, or alternatives. They were intentionally left out." Model the important alternatives, "each one as individual Domain Story, told from beginning to end" | 30–31 |
| Grammar | "Every sentence starts with an actor who initiates an activity"; subject – predicate – object; five shapes: A works on w; A works on w to edit v; A hands w to B (a preposition labels the second arrow); several recipients; A and B collaborate on w | 31–33 |
| Out loud | "the expressiveness of a Domain Story is more important than the correctness of the grammar"; "you should be able to read the sentence out loud"; model out loud (Evans) | 33 |

Good language style (pp. 34–38) — the authors' own do's and don'ts:

- **Give every sentence its own work objects**: different icons for the same thing (QR code, then printed ticket),
  fewer arrows into one pictogram, groups without overlap.
- **Make work objects explicit**: not hidden in the activity ("searches for available seat in" → the *seat* is a work
  object), not hidden in another work object. Later uses (boundaries, code) depend on this.
- **Label every building block**: "what is obvious to you is not necessarily obvious to other people"; "readability
  over brevity".
- **Different icons for actors and work objects.**
- **Avoid loopbacks**: arrows are not data flow; *system calculates price* is one sentence, not system → price → system.
- **Avoid the technical request-and-response pattern** between a user and a system: "it does not tell a compelling
  story"; documentation of an implementation is a sequence diagram's job, a UI is a mock-up's. "Use Domain
  Storytelling to model intent: What is the goal of the user? How does the software system help him to reach that
  goal? Each activity should push the story forward."

## Chapter 3 — Scenario-based modeling (pp. 39–44)

- A domain story is a scenario (Carroll): people and their activities, a fixed context, actors with goals, a plot.
- "Start modeling the default case — the '80% case' — and the 'happy path' first." Narrow it with assumptions
  ("assuming that there are still seats available, what do you do next?") and write them down as annotations.
- Important variations and error cases are separate stories; "small variations … such as optional activities simply
  are not worth the effort" — annotate them.
- A variation story often starts as a copy of the happy path; the first differing sentence is annotated ("Assumption:
  no seats available") and the plot diverges from there. Telling it from the first differing step is also fine.
- "First establish a sound understanding of typical cases — tell stories. Only then discuss what else could happen —
  collect rules." (Example Mapping helps with the rules.)
- No typical case? Model three past cases of rising complexity.
- "Aim for a representative sample, not for completeness!" A coarse-grained story is the anchor for the fine ones.

## Chapter 4 — Scope (pp. 45–52)

- Scope = granularity × domain purity × point in time. Often part of the story's name.
- Granularity: coarse ↔ fine, continuous. Medium-to-fine means activities "have the size of user stories or even
  methods/functions". "If you find yourself modeling detailed interactions between users and systems (e.g., 'customer
  clicks button') … you have probably gone too far." "Always aim for a consistent level of detail throughout a story.
  Mixing fine-grained and coarse-grained activities can be considered a 'bad smell'."
- Cockburn's goal levels as a metaphor: cloud, kite (summary, more than one session), **sea** (a user goal, one
  session), fish, clam ("too low"). The coarse Metropolis story is kite level, the fine one sea level. Coarse stories
  need people from several departments (up to 15); fine ones two to seven.
- As-is = problem space, to-be = solution space; several to-be points in time, or alternatives, may be modeled.
- Pure = without software systems; digitalized = with. Pure stories help build new software "without also
  understanding the accidental complexity added by existing software" — ask how things were done "in the
  pen-and-paper days". Digitalized as-is stories show "which activities are not motivated by the domain but required
  to work with the present software systems". Digitalized to-be stories are "often a further development of a pure
  as-is story".
- Typical journey: coarse pure as-is (explore, often end-to-end from the customer's viewpoint; add a few sentences
  before the beginning and after the end to see what end-to-end means) → fine pure as-is (drill into a sub-domain;
  add a sentence at each end to see the interfaces between departments) → fine digitalized to-be (introduce software;
  the sentences a system must support are its first requirements). "These are only examples … Feel free to adapt."

## Chapter 5 — Tools (pp. 53–61)

- Paper or whiteboard first; a digital tool when the story must be shared, replayed or kept. Whatever the tool, the
  story must stay visible to everyone while it is told. (Egon.io is the authors' modeler.)

## Chapter 6 — The workshop (pp. 62–77)

- Before: the host's questions — what must be answered, the biggest problems, which perspective, which core tasks;
  then the processes to cover and their scope; invite real experts from every silo, not proxies; a customer's view via
  someone who works with customers. 30 minutes can be enough for one as-is story; to-be stories take longer; 2–3
  stories per session.
- The moderator keeps the story going: "What happens next? Where do you get this information? How do you determine
  what to do next? How do you do that?" Ask why; "that is the way we have always done it" is a finding.
- Recording: re-tell each sentence as you draw it; "is this the right term?"; introduce each icon when it first
  appears; "most of the story should be presented in the pictographic language, with some textual annotations — not
  the other way round"; avoid plot holes (parts not joined by arrows); pain points as differently coloured notes;
  check the granularity stays consistent.
- Stuck: start with an assumption instead of the real beginning; one storyline; no mixing of as-is and to-be; park
  objections and ideas as annotations; name actors after people when they disagree; and ask whether the method fits
  the job at all.
- Length: about 10 sentences on a flipchart, 15 on a whiteboard, 20 in a digital tool.
- Finishing: "tell the story from the beginning and try to get agreement: Did we miss something? Is something
  obviously wrong? Do all domain experts agree?" Revisit the annotations: minor variation or a story of its own? "Are
  we talking about the same task which is sometimes done differently? Or … a different task?"
- Roles: a moderator asks and keeps the pace; a modeler may draw separately so the moderator can face the room.

## Chapter 7 — Other methods (pp. 78–89)

- **EventStorming**: "an event storm shows what's happening, a Domain Story shows who is doing what with whom"; an
  event storm can hold several scenarios in lanes, a domain story holds one. Use EventStorming when the domain is
  unstructured, when it "is characterized by time-related processes and status changes", or when a very detailed
  scenario would need dozens of sentences. Combine: a cooperative part of a big-picture event storm retold as a domain
  story; software-design EventStorming after medium-grained stories.
- **User Story Mapping**: a story map shows several granularities at once and plans delivery, but "doesn't show how
  the actors of a story collaborate". Typical order: coarse-grained to-be domain stories → a story map's backbone →
  fine-grained stories when a user story is sprint-ready.
- Also related: Example Mapping (rules and examples), Storystorming, use cases (scenario-based too), UML, BPMN
  (gateways — exactly what domain stories leave out).

## Chapter 9 — Learning the domain language (pp. 104–114)

- Listen for the words people use; make them the labels. Homonyms (one word, two meanings — "account") and synonyms
  (two words, one meaning) are discoveries, not errors: annotate them in coarse-grained stories, and work out an
  unambiguous language per sub-domain in detailed stories (DDD's ubiquitous language). Do not synthesise "an artificial
  language" across sub-domains. A glossary is a good by-product; terms with a defining annotation belong in it.

## Chapter 10 — Finding boundaries (pp. 115–127)

- "Sub-domains consist of activities that belong together from an actor's perspective." Recipe: meaningful scenarios →
  coarse-grained, as-is, **pure** stories (cloud / kite level; pure, so existing systems do not taint the cut) → ask the
  experts which sentences belong together ("sentences one to four, that is the offering part") → group them visually,
  actors that span several groups outside the outlines. A heuristic, "rather than a strict rule"; several scenarios are
  needed, one journey misses most of the map.

## Chapter 11 — Modeling in code (pp. 128–145)

- Work objects are the concepts of the domain model; activities say what can be done with them. Fine-grained,
  digitalized stories are the input; the book walks from sentences to classes and methods (domain model pattern for
  core domains).

## Chapter 12 — Requirements (pp. 146–158)

- The recipe: model the to-be process as a coarse-grained story; "for every activity, ask if it should be supported
  by the new software system … write one requirement"; model significant variations as separate stories and write a
  requirement per new sentence; organise with user story mapping; repeat per sub-domain.
- A sentence maps onto a user story: "As an *actor* I want to *activity plus work object* so that …" — the "so that"
  comes from annotations or the conversation. A user story is "a promise for a conversation", not a specification.

## Chapters 13–15 — Change, make-or-buy, shadow IT (pp. 159–181; from section titles and chapter 2's note on colour)

- Comparing as-is and to-be stories shows how work changes (chapter 2 says colour or highlighting marks the
  differences between versions); the processes an off-the-shelf system assumes can be told as stories and compared;
  "not only software developers develop software" — the spreadsheets and scripts people use are software systems,
  and drawing them as actors makes hidden systems visible.

## What the book does not say (ours)

- That an outcome ("validation passed") is not a work object — the book only says work objects are nouns; we ask for
  the thing ("validation result") and keep the outcome in the verb or a note.
- That a story mostly about what does not happen is the wrong diagram — the book says each activity pushes the story
  forward and sends time-and-status content to EventStorming; the conclusion is ours.
- Dates in verbs, one word per thing inside one story, "who starts it and who ends up with what" — our checks.
