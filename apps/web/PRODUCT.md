# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Hosts**: a person or company running a Google Meet call with outside guests they have never met. They sign in with Google, set a verification policy, and send the bot into the call.
- **Guests**: outside attendees, on their phone, mid-meeting. They scan a QR code shown in the call and prove facts about themselves with their passport through the Self app.
- **Everyone in the call**: sees the bot's video tile, which shows the QR code and who has been verified.
- **Hackathon judges** (current evaluation context): watch a live demo; the bot's tile inside Meet is the moment they should remember.

## Product Purpose

ProveBack lets a meeting host know that an outside guest is a real, eligible person without collecting their identity documents. A bot joins the Meet call and shows a QR code as its camera; guests scan it and present a zero-knowledge passport proof; the result appears live on the bot tile and the host dashboard. Success: a guest goes from "unknown name in a call" to "verified" in under a minute, and the host never holds a passport scan.

## Positioning

Verification happens inside the meeting, on the guest's own phone, and discloses only what the host's policy asks for (sanctions check, excluded nationalities, name match, minimum age). The host stores results, never documents. A returning guest is recognised by a hashed passport nullifier, not by an account.

## Operating Context

- Google Meet calls; the bot is a participant whose camera is a 1280x720, 15 fps web page.
- The guest flow happens on a phone while the meeting continues on another screen.
- Host dashboard on a laptop, usually beside the Meet window.
- External services behind the API: Google OAuth (host sign-in), Recall.ai (bot), Self (passport proof, verified off-chain on the backend).

## Capabilities and Constraints

- Interface contract v1 (`packages/contract`) is frozen; the web app changes only presentation and interaction.
- Checks: OFAC, excluded countries, optional nationality disclosure, name match (off / warn / require), minimum age.
- Public pages (guest page, bot screen) never receive check details or nationality, only status.
- Known limits: someone else can scan for a guest; Self provides no photo; Meet exposes only display names; the bot must be admitted by the host.
- Fake mode replaces Google, Recall and Self when keys are missing; simulation surfaces must be labelled as such.
- UI language: English.

## Brand Commitments

- Name: ProveBack.
- Must not read as a crypto project (confirmed by the user).
- Must not read as a government or border-control system (confirmed by the user).

## Evidence on Hand

- Working fake-mode flow end to end (host, guest, bot screen).
- No real customers, metrics, testimonials or logos; none may be invented.

## Product Principles

1. Disclose the minimum: show guests exactly what will be revealed before they act.
2. The meeting is the venue: the bot tile must be legible at a glance, at small size, through video compression.
3. Results, not documents: the host sees outcomes and reasons, never raw identity data.
4. Verification should feel like being welcomed in, not being inspected.

## Accessibility & Inclusion

The bot screen is viewed as compressed 720p video, often in a small tile: large type, strong contrast, status never carried by colour alone.
