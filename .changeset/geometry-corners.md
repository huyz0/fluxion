---
"@fluxion/sdk": patch
"@fluxion/pack-flowchart": patch
"@fluxion/pack-infographic": patch
---

The shared pack geometry check also evaluates every corner of a shape's number-param range (every pair's corners beyond six params) and resizes each shape to 16 units; the flowchart terminator and delay and the infographic step pill keep their rounded ends inside a narrow box.
