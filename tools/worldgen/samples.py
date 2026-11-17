"""Real-world terrain photo samples used to texture the generated planet.

Every sample is cut from NASA's Blue Marble: Next Generation mosaic
(public domain, NASA Earth Observatory), served by NASA GIBS.

Each entry: biome -> list of (name, centre_lat, centre_lon, span_deg).
The span is in degrees of latitude; the longitude span is widened by
1/cos(lat) so every sample covers a roughly square patch of ground.
Locations are picked to avoid big lakes, coastlines, rivers and cloud,
because anything distinctive in a sample repeats across the planet.

Oceans are not sampled: Blue Marble open ocean is near-black, so the
generator colours water from the generated sea depth instead.
"""

SPAN = 6.0

SAMPLES = {
    "rainforest": [
        ("congo", 1.5, 23.0, SPAN),
        ("borneo", 0.5, 114.0, 4.0),
        ("gabon", 0.5, 12.5, 4.0),
    ],
    "temperate_forest": [
        ("germany", 49.5, 10.0, 4.0),
        ("appalachia", 37.0, -81.5, 4.0),
        ("carpathians", 46.0, 25.0, 4.0),
    ],
    "boreal": [
        ("siberia", 60.0, 105.0, SPAN),
        ("siberia_east", 58.0, 120.0, SPAN),
        ("yenisei_east", 62.0, 95.0, SPAN),
    ],
    "grassland": [
        ("kansas", 39.0, -99.0, SPAN),
        ("black_earth", 51.5, 40.0, 4.0),
        ("pampas", -34.0, -61.0, 4.0),
    ],
    "steppe": [
        ("kazakhstan", 49.0, 68.0, SPAN),
        ("mongolia", 46.0, 105.0, SPAN),
    ],
    "savanna": [
        ("chad", 11.5, 19.0, 4.0),
        ("zambia", -13.0, 25.0, 4.0),
        ("north_australia", -17.0, 135.0, SPAN),
    ],
    "desert_sand": [
        ("grand_erg", 27.0, 8.0, SPAN),
        ("rub_al_khali", 20.5, 50.0, SPAN),
        ("western_desert", 24.5, 27.0, SPAN),
    ],
    "desert_rock": [
        ("australia_centre", -25.0, 128.0, SPAN),
        ("hoggar", 23.0, 10.0, SPAN),
    ],
    "shrubland": [
        ("spain", 40.0, -3.5, 3.0),
        ("karoo", -30.0, 23.0, SPAN),
    ],
    "tundra": [
        ("kitikmeot", 66.0, -110.0, 4.0),
        ("kolyma", 69.5, 140.0, 4.0),
        ("east_siberia", 68.0, 160.0, 4.0),
    ],
    "ice": [
        ("greenland", 75.0, -40.0, SPAN),
        ("antarctica", -80.0, 60.0, SPAN),
    ],
    "mountain": [
        ("kunlun", 35.5, 82.0, 4.0),
        ("alps", 46.3, 8.0, 3.0),
        ("puna", -24.0, -67.5, 4.0),
    ],
}
