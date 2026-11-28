# `scanner/`: the on-device archive scanner

The scanner every R2 lens shares ([ADR-0049](../../../../docs/adr/0049-the-on-device-archive-scanner.md), #491). It reads X's archive and the Library, which are already on the computer, and proposes findings, each with its reason. It never touches X:

- it imports only `scanner/` and `shared/` (rule `ext-scanner-is-headless`);
- it sends no message to a content script, and opens, reads or steers no X tab;
- the only `fetch` it will have is `models/store.ts`, which downloads a model pack the person asked for (ADR-0051).

A finding is a proposal. Only Cleanup, with its consent, preview, backup and typed DELETE, acts on X.

## Files

| File       | Responsibility                                                                                                                                                                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ports.ts` | The scanner's ports: `ModelRunner` (a model on the computer, its availability and its untrusted answers), `ScanStore` (a page of items to read, and a page's proposals saved with the run's cursor), `Clock`, `ScannerPorts`, and the shapes they carry (`ScanItem`, `FindingProposal`, `ModelRequest`). Interfaces only. |

The core comes in CS.2 and CS.4: text normalization, rules and detectors, the worker and its controller, and the model runners behind these ports, wired in `platform.ts`.

## Rules

- `ext-scanner-is-headless` (`.dependency-cruiser.cjs`): `scanner/` imports only `scanner/` and `shared/`.
- `ext-scanner-core-uses-ports`: the core never imports the model adapters (`models/chrome-ai.ts`, `models/transformers.ts`, `models/webllm.ts`, `models/store.ts`); only `platform.ts` and `models/` do.
- ESLint: no `chrome` and no `fetch` in the scanner, but in `platform.ts` and `models/store.ts`.

## Depends on

- `../shared/` only: the data model and the database.
- At runtime, its own Web Worker for a scan (CS.2), and a Web Lock, `xomoni-scanner`, so one scan runs per profile.
