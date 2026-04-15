# Craft Flow

Build a feature with impeccable UX and UI quality through a structured process: shape the design, load the right references, then build and iterate visually until the result is delightful.

## Step 1: Shape the Design

Run /shape, passing along whatever feature description the user provided.

Wait for the design brief to be fully confirmed before proceeding. The brief is your blueprint, and every implementation decision should trace back to it.

If the user has already run /shape and has a confirmed design brief, skip this step and use the existing brief.

## Step 2: Load References

Based on the design brief's "Recommended References" section, consult the relevant impeccable reference files. At minimum, always consult:

- [spatial-design.md](spatial-design.md) for layout and spacing
- [typography.md](typography.md) for type hierarchy

Then add references based on the brief's needs:
- Complex interactions or forms? Consult [interaction-design.md](interaction-design.md)
- Animation or transitions? Consult [motion-design.md](motion-design.md)
- Color-heavy or themed? Consult [color-and-contrast.md](color-and-contrast.md)
- Responsive requirements? Consult [responsive-design.md](responsive-design.md)
- Heavy on copy, labels, or errors? Consult [ux-writing.md](ux-writing.md)

## Step 3: Build

Implement the feature following the design brief. Work in this order:

1. **Structure first**: HTML/semantic structure for the primary state. No styling yet.
2. **Layout and spacing**: Establish the spatial rhythm and visual hierarchy.
3. **Typography and color**: Apply the type scale and color system.
4. **Interactive states**: Hover, focus, active, disabled.
5. **Edge case states**: Empty, loading, error, overflow, first-run.
6. **Motion**: Purposeful transitions and animations (if appropriate).
7. **Responsive**: Adapt for different viewports. Don't just shrink; redesign for the context.

### During Build
- Test with real (or realistic) data at every step, not placeholder text
- Check each state as you build it, not all at the end
- If you discover a design question, stop and ask rather than guessing
- Every visual choice should trace back to something in the design brief

## Step 4: Visual Iteration

**This step is critical.** Do not stop after the first implementation pass.

Open the result in a browser window. If browser automation tools are available, use them to navigate to the page and visually inspect the result. If not, ask the user to open it and provide feedback.

Iterate through these checks visually:

1. **Does it match the brief?** Compare the live result against every section of the design brief. Fix discrepancies.
2. **Does it pass the AI slop test?** If someone saw this and said "AI made this," would they believe it immediately? If yes, it needs more design intention.
3. **Check against impeccable's DON'T guidelines.** Fix any anti-pattern violations.
4. **Check every state.** Navigate through empty, error, loading, and edge case states. Each one should feel intentional, not like an afterthought.
5. **Check responsive.** Resize the viewport. Does it adapt well or just shrink?
6. **Check the details.** Spacing consistency, type hierarchy clarity, color contrast, interactive feedback, motion timing.

After each round of fixes, visually verify again. **Repeat until you would be proud to show this to the user.** The bar is not "it works"; the bar is "this delights."

## Step 5: Present

Present the result to the user:
- Show the feature in its primary state
- Walk through the key states (empty, error, responsive)
- Explain design decisions that connect back to the design brief
- Ask: "What's working? What isn't?"

Iterate based on feedback. Good design is rarely right on the first pass.
