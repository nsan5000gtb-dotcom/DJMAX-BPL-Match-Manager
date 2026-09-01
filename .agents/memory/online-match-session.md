---
name: Online match synchronization
description: Durable product decision for sharing DJMAX BPL match state between two browsers.
---

Two-player matches should use a short session key, per-player client token, server-persisted state, and polling rather than relying on browser-local state.

**Why:** localStorage is isolated to one browser and cannot synchronize a shared match; the server also needs to enforce player roles and ownership rules.

**How to apply:** keep match mutations behind the session API, return only the caller's token, validate candidate songs against the shared pack pool and current round, and reveal player selections only after both sides have submitted.