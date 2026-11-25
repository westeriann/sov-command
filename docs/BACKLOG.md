# Backlog: testing round after the Orbital build

Status: every item below has been worked through (see the git log on this branch); the notes
at the end record what was learnt about the globe.

Reported while testing the installers from the Orbital redesign build. Map work is held
until the go-ahead; interface work can go first.

## A. Interface and sound

1. **Parliament**: hovering highlights a seat; clicking selects a named member (name, party,
   area). Looks only for now. Also: with a military council, a circle sits over the star in
   the chamber. Work out whether a seat is drawn over the star or the circle is a stray
   extra, and make the council show as the star.
2. **Diplomacy globe**:
   - Clicking a small nation next to your own picks yours; the nation under the cursor
     must win.
   - It flickers: flashes on, waits, goes darker, sometimes jumps up/down or side to side.
   - Nation names shake slightly as the globe turns.
   - Zoom in and out (mouse wheel / pinch).
3. **Bottom bar**: lenses centred; forces count small, above the lens buttons, moving to the
   top of the lens menu while a lens is open.
4. **Map modes window**: the "Show" section can be collapsed to save space.
5. **Eco lens, Build**: Build closes the lens, you pick provinces, a menu chooses what to
   build; backing out returns to the Eco lens.
6. **Roads (tool)**: drag a road where you like in the build flow, snapping to province
   centres, cities and other sensible points. Drawing them on the map is item 21.
7. **Forces centrepieces** (Ground Forces, Naval Ops, Air Command): troop models roll in,
   stop, then animate in place (turret turning, ship gun moving, plane flying in place).
   Hover shows how many of each you have fielded.
8. **Sounds**: a province click plays an ambience for its type (city bustle, farm animals,
   mountain wind and rarely a goat, forest birds, desert wind, coast waves and gulls,
   arctic wind, industry, bases); a small sound on hovering the Economy rings. Sourced and
   shown for review before adding. Each sound gets a small matching scene on the map that
   fades in, plays briefly and fades out so the map never clutters: birds or gulls fly a
   short way, farm animals, a goat on a ridge, and so on for what the province is known
   for (items 26 to 28 cover the look).
9. **No emojis anywhere**: province specialty icons become drawn icons in the theme.
10. **Nation quick card**: clicking a nation's name in any tab opens a small card with key
   figures (country, economy, military, diplomacy) and a Zoom to button, instead of
   jumping the map straight away.
11. **Small screens (1280x800)**: Espionage cut off top and bottom; Diplomacy text overlaps
   the globe; Market tickers overlap; Economy ring clipped top and bottom, and the tax and
   welfare buttons too. (2560x1080 was fine.)

## B. Map (held until the go-ahead), most urgent first

12. **Globe going black**: zooming out fast blanks the whole globe, half of it, or the top
    or bottom for a split second; now even slow zooming blacks out rivers and parts of the
    globe briefly. Highest priority.
13. **Mountains and cliffs**: must look as good as the rest of the terrain. Some are still
    blurry, smeared and pale, especially near coasts. High priority.
14. **Coasts and ocean depth**:
    - A pale line follows every coast and fades as you zoom in.
    - Shallow water shows as blobs of light.
    - Water should deepen gradually from the shore out to the ocean floor and look natural.
15. **Political colours vs imagery**: in many places the province colour and borders stop
    while the satellite land carries on (or the colour spills over water), leaving jagged,
    blocky edges. Colours and borders must follow the imagery's coastline. The province
    highlight (hover and selection) sometimes follows neither the imagery nor the colour.
16. **Bright cup under the globe**: a large, slightly bright shading cups the bottom of the
    globe. Fix together with the **poles**, which are a void and should be ice caps you
    cannot enter.
17. **Flat mode**: glitchy; centre it and make it match the globe's look.
18. **Buildings, troops and cities**:
    - Buildings: a fixed, sensible size; they must not drift or scale with the camera.
    - Troops: the only things that scale with the camera, and much less than now.
    - Cities: far too small; scale up.
    - Skyscrapers vanish at the lowest tilt while their tops and ordinary buildings stay.
    - City sprawl texture: redraw cleaner and at higher resolution.
19. **Night lights**: natural city light patterns instead of round blobs; a few sparse
    lights in the countryside.
20. **Political map colour strength**: a slider so satellite imagery shows through.
21. **Roads** drawn on the map (the tool is item 6).
22. **Trade routes, merchant ships and blockades**:
    - Routes follow realistic shipping paths (straits, around capes, along coasts).
    - They blend into the background: faint and thin, not standing out as now.
    - Merchant ships travel them, for looks only.
    - A warship on a route cuts it only for enemies at war with you, never neutrals.
      Touches the war and economy rules and the manual.
23. **Back to my nation** button for when you are lost on the globe.
24. **Tiny islands** scattered in the open ocean. Needs the planet generated again: one
    slow build (about 25 min), then the saved planet is reused.
25. **Storms**: 3D clouds and hurricanes from real imagery; rain falls from the cloud base
    instead of laying over it.
26. **Realistic lighting**: realistic shaders across the globe, lit by a distant, realistic
    sun (soft day and night edge, atmosphere scattering, specular glint on water).
27. **Realistic oceans**: up close, moving waves and sea life (fish shoals, whales,
    dolphins) that fade in and out.
28. **Province vignettes**: the short scenes from item 8 drawn on the map, fading in and out.

## Third testing round

1. Day/night shading blinks across the globe at speed: remove it.
2. Still laggy at speed.
3. The northern ice cap shows through the globe from the far side.
4. Political colours are blocky while the photo's coast is smooth: give the political map the
   photo's borders. Lakes and inland seas get painted as land (the "paint over nothing").
5. Clouds all look like crosses: vary their shapes.
6. Espionage: the stack is cut off at the top, and its three tiles cannot be clicked.
7. Mountainsides meeting the coast still look bad.
8. Deserts: far smaller and rarer.
9. Naval Ops: the destroyer's gun floats free of the ship.
10. Ground Forces: the special forces helicopter flies in backwards.
11. Remove the empty ring under every screen's centrepiece.
12. Budget sliders: move freely, then a Finalize budget button confirms (no automatic
    rebalancing of the other sliders).
13. A star on the map at every capital, coloured by form of government.
14. Cities placed by their surroundings within their province (shores, lakes, rivers, the foot
    of mountains, valleys) instead of at its centre; same provinces and names.

15. Sea particles and animals float in space when you zoom out quickly.
16. A beeping, dial-tone-like sound loops constantly in the background: remove it.
17. Hurricanes clickable for more information.
18. A development index per province: more cities and people mean more developed, more
    countryside means less. It speeds building a lot and recruiting a little; less developed
    provinces lean right-wing, authoritarian and selfish, cities and crowds lean left and liberal.
19. Borders that do not follow the coloured outline: find and fix every such spot.
20. Each placed city becomes its own very small province inside its current province.

Status of the third round: all done. Cities (14, 20) are 2,778 small provinces carved by
`carve_cities` in `tools/worldgen/provinces.py`, numbered after the existing ones so no
province, name, nation or neighbour changes; each takes about half its province's people and
every capital moves into its city. In the 3D layer the core buildings of a city keep apart
(they may clip by 12% of their size, also across neighbouring cities) while the low sprawl
overlaps freely. Mountainsides at the coast (7) got a shading taper in the planet build: check
it in the next installer.

## Fixed after the preview round

- **Lag at high game speed** (worst while moving): every game tick re-sent all trade lanes
  (~20,000 points), roads and building icons to the map and redrew the side panels. Now map
  data goes only when it changes, lane legs are routed once and shared, and panels redraw at
  most four times a second: about 75% less time in game updates at 20x.
- **Poles**: curved ice caps drawn over both poles in the 3D layer (the imagery stops at 85
  degrees), fading into the photo and dimming in polar night with the sunlight.
- **Arctic sea ice edge**: a wider band broken into floes and leads (in the next planet build).
- Found in the check: the road tool never set up its map layers (it waited for a load event
  that had already passed), so roads could not be drawn or shown; and in build or road mode,
  unit markers swallowed clicks on the provinces under them.
- Found in the previews: the troop models on the forces screens were invisible (their
  animations restarted every game tick, or never started).

## Globe notes (keep for any rebuild of the planet)

Causes found and fixed:

- **Blackouts while zooming**: after each zoom the game called `map.setTerrain()` to change the
  mountain exaggeration. That destroys MapLibre's terrain and its render-to-texture targets, so
  everything drawn through them went black for a frame. Fix: change the exaggeration on the live
  terrain object (`setExaggeration` in `client/src/map.ts`). Never call `setTerrain` while moving.
- **Pale line along every coast**: the relief tiles had land standing up at the shore against a
  flattened sea; raised by up to 14x exaggeration it became a wall the photo was stretched down,
  and the hillshade lit it as a bright line (fading with zoom because hillshade exaggeration falls
  with zoom). Fix: land ramps up from the shore over ~5 grid cells in `tools/worldgen/dem.py`,
  exaggeration capped at 8x, gentler hillshade.
- **Blurry mountains**: relief tiles stopped at zoom 5 from a 4096-wide grid. Now zoom 6, with
  ridged detail proportional to height (built a band of tiles at a time to fit in memory).
- **Province colours vs photo coast**: the photo's shore was the height contour plus strong noise,
  the provinces a nearest-cell grid. Now the photo's shore follows the contour with light noise,
  and the province colours fade out along a bilinear contour of the same grid.
- **Shallow-water blobs**: water colour came from depth blurred only ~1.6 cells; now 3.2 cells,
  softer shelf colours and a thin output-resolution shore wash.
- **Poles**: the style's background layer shows on the globe only where no tiles are (the poles):
  it is ice-coloured on the globe and switched to dark space on the flat map.
- **Diplomacy globe strobing**: its sun was recomputed once a second from a clock running a day
  every ten seconds; it now moves every frame, with a softer night side.

Earlier notes:

Problems seen in the tested build, with what is known about each:

- **Blackouts while zooming**: tiles (and rivers) drop out for a frame while zooming, worse
  when fast. Suspect tiles unloaded before their replacements are ready, a depth or
  clipping-plane jump at zoom thresholds, or the terrain mesh swapping detail levels.
  Check the tile cache size, keeping parent tiles until children load, and the camera's
  near and far planes during zoom.
- **Blurry mountains near coasts**: relief along some coastlines shows as soft, smeared,
  pale ridges, as if the height data or hillshade is stretched or too low-resolution
  there. Check the height tile zoom against the colour tiles and the terrain exaggeration
  where land meets sea.
- **Pale coastline line**: a thin white line traces every coast at mid zoom and fades as you
  zoom in. Probably a coast highlight or line layer whose width or opacity does not follow
  zoom, or a halo from mixing water and land colours at a coarser tile zoom.
- **Shallow water as blobs**: the shelf colouring is patchy light blobs rather than a
  smooth depth gradient. Water needs real depth (bathymetry) shading.
- **Province fill vs imagery**: the province grid's coastline does not match the satellite
  imagery's, so fills stop short or spill over and their edges look pixel-blocky. The
  province raster and the imagery should come from the same coastline, at a resolution
  that does not show stair-steps.
- **Bright cup under the globe**: an atmosphere or glow layer seems to sit offset below the
  globe.
- **Poles**: the projection leaves an empty void at the poles; nothing covers it.
- **Flat mode**: not centred and does not match the globe's style.
- **Build time**: generating the planet takes about 22 min on 4 cores and runs only when
  `tools/worldgen/**` or `assets/samples/**` changes; otherwise CI reuses the cached
  planet (`world-<hash>`). Painting runs in parallel strips, with identical output.
- **Sample photos**: the GIBS service fails at times; the samples are committed to the repo
  and fetching retries with backoff, so a build does not depend on it.
- **Windows installer**: the host bundle (about 23,000 small tile files) cannot be unpacked
  by the artifact download on Windows; it goes over as a single `host.tar`.
