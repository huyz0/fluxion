// The full example of 06-ai-authoring.md §2.1 (checkout.flux.yaml), as the read stage's fixture.
export const CHECKOUT = `flux: 1
title: How our checkout works
theme: { preset: ocean, mode: auto, accent: "#7C5CFF" }  # seeds only; palette is generated
uses: [basic, flowchart, icons-lucide, effects-core]
screens:
  - id: intro
    kind: title                            # archetype template (dslMacros registry)
    title: How checkout works
    subtitle: From cart to confirmation in 400 ms
  - id: arch
    title: Architecture
    layout: { type: layered, direction: right, spacing: comfortable }
    nodes:
      web:   { shape: rounded-rect, label: Web, icon: lucide:globe }
      api:   { shape: rounded-rect, label: API Gateway, tone: accent }
      pay:   { shape: rounded-rect, label: Payments, badge: PCI }
      db:    { shape: flowchart:database, label: Orders DB, alt: Orders database }
      queue: { shape: flowchart:queue, label: Events, pin: { x: 1500, y: 820 } }
      sla:   { component: basic:stat, props: { value: 400ms, label: p95 latency } }
    groups:
      backend: { label: Backend, contains: [api, pay, db], style: dashed }
    edges:
      - web -> api: HTTPS
      - api -> pay: charge()
      - api -> db
      - pay ~> queue: { label: event, flow: dots }
    steps:
      - show: [web, api]
      - { show: [pay, db], effect: fade }
      - { highlight: api, with: previous }
      - { animate: "pay ~> queue", effect: flow, riders: { shape: effects-core:dot, count: 5 } }
    interactions:
      - { on: click pay, do: popup pay-detail }
      - { on: click db, do: { goto: data-model, transition: zoom } }
  - id: pay-detail
    kind: popup
    markdown: |
      **Payments** retries 3× with backoff; one idempotency key per order.
  - id: data-model
    title: Data model
    mermaid: |
      erDiagram
        ORDER ||--o{ LINE_ITEM : contains
        ORDER }o--|| CUSTOMER : "placed by"
`;
