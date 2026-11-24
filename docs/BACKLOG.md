# Backlog: testing round after the Orbital build

Reported while testing the installers from the Orbital redesign build. Map work is held
until the go-ahead; interface work can go first.

## A. Interface and sound

1. **Parliament seats**: hover highlights a seat; click selects a named member (name,
   party, area). Looks only for now.
2. **Diplomacy globe, picking**: clicking a small nation next to your own picks yours.
   Fix the hit test so the nation under the cursor wins.
3. **Diplomacy globe, flicker**: flashes on, waits, goes darker; sometimes jumps up/down
   or side to side.
4. **Diplomacy globe, zoom**: mouse wheel / pinch, within limits.
5. **Bottom bar**: lenses centred; forces count small, above the lens buttons, moving to
   the top of the lens menu while a lens is open.
6. **Eco lens, Build**: Build closes the lens, you pick provinces, a menu chooses what to
   build; backing out returns to the Eco lens.
7. **Roads** (in the Eco lens / build flow): drag a road where you like, with snapping to
   province centres, cities and other sensible points. Drawing them is map work (B).
8. **Forces centrepieces** (Ground Forces, Naval Ops, Air Command): troop models roll in,
   stop, then animate in place (turret turning, ship gun moving, plane flying in place).
   Hover shows how many of each you have fielded.
9. **Province click sounds by type**: city bustle, farm animals, mountain wind (rarely a
   goat), forest birds, desert wind, coast waves and gulls, arctic wind, industry,
   bases. Sourced and shown for review before adding.
10. **Economy ring hover sound**: a small sound on hovering the rings.
11. **No emojis anywhere**: province specialty icons become drawn icons in the theme.
12. **Nation quick card**: clicking a nation's name in any tab opens a small card with key
   figures (country, economy, military, diplomacy) and a Zoom to button, instead of
   jumping the map straight away.
13. **Small screens (1280x800)**:
    - Espionage: cut off at the top and bottom.
    - Diplomacy: text overlaps the globe at the bottom.
    - Market: tickers overlap each other.
    - Economy: the ring is clipped at the top and bottom, and so are the tax and welfare
      buttons. (2560x1080 was fine.)

## B. Map (held until the go-ahead)

14. **Buildings**: a fixed, sensible size; they must not drift or scale with the camera.
15. **Troops**: the only things that scale with the camera, and much less than now.
16. **Cities**: far too small; scale up.
17. **Skyscrapers vanish at low tilt**: at the lowest camera angle (right-drag up) the
    towers disappear but their tops and ordinary buildings stay. Clipping or culling.
18. **City sprawl texture**: redraw cleaner and at higher resolution for the new terrain.
19. **Tiny islands** scattered in the open ocean. Needs the planet generated again: one
    slow build (about 25 min), then the saved planet is reused.
20. **Trade routes and merchant ships** (looks only), plus **blockades**: a warship on a
    lane cuts that lane's trade for enemies at war with you, never neutrals. Touches the
    war and economy rules and the manual.
21. **Flat mode**: glitchy; centre it and make it match the globe's look.
22. **Poles**: currently a void with no hole; make them ice caps you cannot enter.
23. **Blurry mountains**: some still smeared (see Globe notes).
24. **White coast line**: a pale line follows every coast and fades as you zoom in (see
    Globe notes).
25. **Back to my nation** button for when you are lost on the globe.
26. **Political map, colour strength**: a slider so satellite imagery shows through.
27. **Night lights**: natural city light patterns instead of round blobs; the countryside
    gets a few sparse lights.
28. **Roads**: drawing the roads from item 7 on the map.
29. **Storms**: 3D clouds and hurricanes from real imagery; rain falls from the cloud
    base instead of laying over it.

## Globe notes (keep for any rebuild of the planet)

Problems seen in the tested build, with what is known about each:

- **Blurry mountains near coasts**: relief along some coastlines shows as soft, smeared,
  pale ridges, as if the height data or hillshade is stretched or too low-resolution
  there, and it reads as white smear along the shore. Check the DEM tile zoom against the
  colour tiles and the terrain exaggeration where land meets sea.
- **Pale coastline line**: a thin white line traces every coast at mid zoom and fades as
  you zoom in. Probably a coast highlight or line layer whose width or opacity does not
  follow zoom, or a halo from mixing water and land colours at a coarser tile zoom.
- **Poles**: the projection leaves an empty void at the poles; nothing covers it.
- **Flat mode**: not centred and does not match the globe's style.
- **Build time**: generating the planet takes about 22 min on 4 cores and runs only when
  `tools/worldgen/**` or `assets/samples/**` changes; otherwise CI reuses the cached
  planet (`world-<hash>`). Painting runs in parallel strips, with identical output.
- **Sample photos**: the GIBS service fails at times; the samples are committed to the repo
  and fetching retries with backoff, so a build does not depend on it.
- **Windows installer**: the host bundle (about 23,000 small tile files) cannot be unpacked
  by the artifact download on Windows; it goes over as a single `host.tar`.
