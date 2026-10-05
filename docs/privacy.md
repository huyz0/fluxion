# Privacy

Fluxion has no telemetry. Nothing about you, your documents or how you use the studio is sent anywhere. This page says what is kept on your machine, what the studio
fetches and when, and what you can copy out to report a problem. (NFR-SEC-006, NFR-OBS-002)

## What leaves your machine

Nothing, unless you ask for it:

- **Documents** are files on your disk (`.flux`, `.flux.html`) or autosave copies in your browser's own storage. The studio never uploads them.
- **Fonts**: the Google Fonts tab of the font picker fetches the font you pick from Google, only when you pick it. A document that has the font inside it needs no fetch.
- **Opening a file by address** (`?src=`) fetches that address, without cookies or a referrer, only when you open the studio with it.
- **Analytics, error reports, crash reports and update checks**: none. There is no account and no sign-in.

The end-to-end test `e2e/privacy.no-telemetry.spec.ts` opens a document, edits it, saves it and presents it with every request to a non-local host blocked, and fails if one is
made.

## What is kept on your machine

- Autosave copies of the documents you are editing, and your recent files, in the browser's storage; clearing the site's data removes them.
- Your settings (key bindings, the theme and layout you chose), in the browser's storage.

## Reporting a problem: the diagnostic report

The **Copy diagnostic report** button puts a short JSON text on your clipboard and sends it nowhere. You paste it where you choose. It holds:

- the versions of the studio, the schema and the file format, and your browser's user agent;
- how big the document is: the number of records, of each type, and of each kind of element;
- how many warnings and errors the studio logged, by level and by area.

It never holds anything the document says: no text, titles, names, labels, links, asset names or ids. The unit test `NFR-OBS-002: the report holds no document text` writes
a sentinel into every place a document keeps words and checks that it does not appear.

## Logging

The studio writes warnings and errors to the browser's console. To see more, add `?level=debug&log=layout:*` to the address (a level, and the areas to show). Nothing is
stored or sent.
