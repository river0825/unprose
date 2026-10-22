# Icons of your own — drawing work objects that say what they are

"An icon set should be adapted to the domain" (a container icon in logistics), "the icons should convey meaning and
make the Domain Story more tangible", and "too many different icons will water down your pictographic language"
(the book, p. 21). Unprose has eight generic work-object icons — document, thing, digital, folder, call, email,
conversation, info. When most of a story's work objects end up as the same one (usually the document, which is also
what a work object without a `kind` gets), the reader cannot tell them apart: draw icons of your own.
`design_lint` says so (`work-objects-one-icon`) when half or more of the work objects share one icon.

## When

- The main work object — the one the story follows — deserves an icon of its own almost always.
- Things people in the domain recognise by their shape: an invoice, a parcel, a prescription, a container, a
  boarding pass, a contract with a signature.
- Not every work object: one icon per *kind* of thing, reused by every work object of that kind. Three to seven icons
  for a story is plenty; a generic thing can stay a built-in kind.
- The same thing may change its icon when its medium changes (an order taken over the phone `call`, then the order
  form `order`, p. 26) — under the same name.
- Actors keep person, group and system (the method names those three); never give an actor and a work object the
  same icon (p. 35).

## How

```yaml
icons:
  invoice: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z"/><path d="M9 7.5h6M9 11h6M9 14.5h3.5"/></svg>'
workObjects:
  - { id: invoice, text: invoice, kind: invoice }   # the icon's name is the kind
```

- A **line drawing on a 24 × 24 box** (`viewBox="0 0 24 24"`). The board strokes every shape in the ink colour,
  1.9 wide with round ends, and never fills it — draw outlines, not silhouettes.
- Plain shapes only: `<path d>`, `<circle>`, `<ellipse>`, `<rect>` (`rx` for rounded corners), `<line>`,
  `<polyline>`, `<polygon>`, with plain numbers. Fills, styles, `transform`, `<g>`, text, images and links are not
  read (an icon is text an agent wrote; it is never put on the page as it came) — a shape inside a `<g transform>`
  is drawn without the transform. At most 40 shapes and 4000 characters; two to six shapes is what reads well.
- Keep the main outline about 3 to 21 on each axis, like the built-in icons, and details at least 2 apart: the
  icon is drawn about 40 px wide, smaller when zoomed out. A recognisable outline plus one or two details (the lines
  on a form, the hands of a clock) beats a picture.
- Name it by the thing in the domain's words (`invoice`, `prescription`, `parcel`) and use that name as the `kind`.
- `design_lint` warns about an icon it cannot draw (`icon-invalid`) and a kind with no icon (`icon-unknown`);
  look at the board or `canvas_snapshot` once to see it.

## A gallery to start from

Copy what fits under `icons:` and change it to the domain; they are our own drawings (Apache-2.0, like Unprose).

### Money and orders

```yaml
invoice: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z"/><path d="M9 7.5h6M9 11h6M9 14.5h3.5"/></svg>'
payment: '<svg viewBox="0 0 24 24"><rect x="2.5" y="6" width="19" height="12" rx="1.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/></svg>'
card: '<svg viewBox="0 0 24 24"><rect x="2.5" y="5.5" width="19" height="13" rx="1.8"/><path d="M2.5 9.8h19M6 14.8h4"/></svg>'
order: '<svg viewBox="0 0 24 24"><path d="M2.8 4h2.6l2.2 10.4h10.2l2-7.4H6.4"/><circle cx="9" cy="18.6" r="1.5"/><circle cx="16.4" cy="18.6" r="1.5"/></svg>'
price: '<svg viewBox="0 0 24 24"><path d="M3.5 12.6V4.5a1 1 0 0 1 1-1h8.1l8.4 8.4-9.1 9.1z"/><circle cx="8" cy="8" r="1.4"/></svg>'
ticket: '<svg viewBox="0 0 24 24"><path d="M3 6h18v3.6a2.4 2.4 0 0 0 0 4.8V18H3v-3.6a2.4 2.4 0 0 0 0-4.8z"/><path d="M14.5 6.8v1.6M14.5 11.2v1.6M14.5 15.6v1.6"/></svg>'
```

### Time

```yaml
appointment: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="1.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><path d="M7.5 13h2M11 13h2M14.5 13h2M7.5 16.5h2M11 16.5h2"/></svg>'
deadline: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.6"/><path d="M12 7v5l3.4 2"/></svg>'
reminder: '<svg viewBox="0 0 24 24"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.6 2H4.4z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>'
```

### Records

```yaml
contract: '<svg viewBox="0 0 24 24"><path d="M6.5 2.8h7.6l4.4 4.4v14h-12z"/><path d="M14 2.8v4.5h4.5"/><path d="M9 10.5h6"/><path d="M8.6 16.6c1-1.6 2-1.9 2.2-.7s.7 1 1.5.1 1.4-.9 2 .2 1 .4 1.4.1"/></svg>'
form: '<svg viewBox="0 0 24 24"><rect x="5" y="4.5" width="14" height="16.5" rx="1.5"/><path d="M9 3h6v3H9z"/><path d="M8 11l1.3 1.3L11.6 10M8 16l1.3 1.3 2.3-2.3M13.5 11.2h3M13.5 16.2h3"/></svg>'
contact: '<svg viewBox="0 0 24 24"><rect x="2.5" y="5" width="19" height="14" rx="1.5"/><circle cx="8.5" cy="10.5" r="2.2"/><path d="M5 16.2c.5-1.8 1.8-2.8 3.5-2.8s3 1 3.5 2.8"/><path d="M14.5 10h4M14.5 13.5h4"/></svg>'
report: '<svg viewBox="0 0 24 24"><path d="M4 3.5v16.5h16.5"/><path d="M8 16v-4M12 16V8M16 16v-6"/></svg>'
list: '<svg viewBox="0 0 24 24"><path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="5" cy="6.5" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="5" cy="17.5" r="1"/></svg>'
photo: '<svg viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="15" rx="1.5"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M3.5 18l5.2-5.2 3.6 3.6 2.6-2.6 5.1 5.1"/></svg>'
link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"/></svg>'
```

### Goods, places, access

```yaml
shipment: '<svg viewBox="0 0 24 24"><path d="M2.5 6h11.5v10H2.5z"/><path d="M14 9.5h4l3 3.5v3h-7"/><circle cx="6.5" cy="17.6" r="1.7"/><circle cx="17" cy="17.6" r="1.7"/></svg>'
place: '<svg viewBox="0 0 24 24"><path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/></svg>'
key: '<svg viewBox="0 0 24 24"><circle cx="7.8" cy="12" r="3.8"/><path d="M11.6 12h9M17.5 12v3M20.5 12v2.2"/></svg>'
approval: '<svg viewBox="0 0 24 24"><path d="M12 3l7.5 2.8v5.6c0 4.6-3.2 8.2-7.5 9.6-4.3-1.4-7.5-5-7.5-9.6V5.8z"/><path d="M8.8 12l2.2 2.2 4.2-4.4"/></svg>'
milestone: '<svg viewBox="0 0 24 24"><path d="M5 21V3.5"/><path d="M5 4h12.5l-2.5 4 2.5 4H5"/></svg>'
goal: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.8"/><circle cx="12" cy="12" r="1.2"/></svg>'
```

A thing the gallery does not have: start from its outline (a container is a long box with ribs: `<rect x="2"
y="7" width="20" height="10"/><path d="M6 7v10M10 7v10M14 7v10M18 7v10"/>`), add the one detail that tells it apart,
draw it, and look.
