// Mermaid sources for the importer tests (FR-IMP-001): one per supported kind, plus the unsupported lines a real file carries.

export const FLOWCHART: string = `flowchart LR
  %% a comment
  start([Order placed]) --> check{In stock?}
  check -->|yes| pack[Pack it]
  check -- no --> wait(Wait for stock)
  subgraph warehouse [Warehouse]
    pack --> ship((Ship))
    wait -.-> pack
  end
  ship ==> done[(Archive)]
  style start fill:#f9f
  click pack href "https://example.com"
`;

export const SEQUENCE: string = `sequenceDiagram
  participant U as User
  participant S as Server
  U->>S: Sign in
  S-->>U: Token
  Note over U,S: Session starts
  loop every minute
    U->>S: Ping
  end
`;

export const MINDMAP: string = `mindmap
  root((Plan))
    Research
      Interviews
      Survey
    Build
      Prototype
`;

export const TIMELINE: string = `timeline
  title Company history
  section Early
    2020 : Founded
    2021 : Seed round : First hire
  section Growth
    2023 : Series A
`;

export const CLASS: string = `classDiagram
  class Animal {
    +name
    +eat()
  }
  Animal <|-- Dog
  Dog "1" --> "*" Toy : plays with
  Dog : +bark()
`;

export const ER: string = `erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER {
    int id
    date placed
  }
  ORDER }|--|| PRODUCT : contains
`;

export const SOURCES: {
  readonly flowchart: string;
  readonly sequence: string;
  readonly mindmap: string;
  readonly timeline: string;
  readonly class: string;
  readonly er: string;
} = { flowchart: FLOWCHART, sequence: SEQUENCE, mindmap: MINDMAP, timeline: TIMELINE, class: CLASS, er: ER };
