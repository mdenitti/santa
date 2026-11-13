# Het winterdorp · 90° N

Een interactieve Three.js-kerstwereld met 25 gebouwen, 48 diverse elfen, Santa’s woning,
een grote pakjeswerkplaats, een verlicht dorpsplein en een bestuurbare slee
met acht rendieren. De oorspronkelijke werkplaats met binnenweergave,
het interactieve cadeau en de procedurele audio blijven beschikbaar.

## Lokaal starten

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open de server in een browser met WebGL2. Er is geen buildstap of backend.
Three.js 0.187.0 wordt geladen vanaf `cdn.jsdelivr.net`; internettoegang is
dus nodig. `?intro=0` slaat de intro over en `?debug` toont renderstatistieken.

## Bediening

| Modus | Bediening |
| --- | --- |
| Overzicht | Slepen om te draaien, scrollen om te zoomen |
| POV wandeling | Automatische rondleiding; pauzeer of gebruik WASD/pijltjes voor vrij lopen; sleep om te kijken |
| Bestuur Santa | W/S lopen, A/D draaien, Shift rennen |
| Vlieg met de slee | W/S snelheid, A/D sturen, Spatie stijgen, Shift dalen |
| Terug naar plein | Keert terug naar Santa te voet |
| Escape | Terug naar overzicht |

Op aanraakschermen verschijnen bewegingsknoppen. Voetgangers worden
tegengehouden bij alle boomkruinen, gebouwen, lantaarns, banken en marktkramen.
De automatische wandeling gebruikt een gecontroleerde routeplanner en snijdt
geen bochten door boomtakken af.
De slee blijft boven dakhoogte en binnen het landschap. De rondleiding
begint gepauzeerd bij een voorkeur voor minder beweging.

## Feestmodus · 25 december

**25 dec · Feestmodus** schakelt het kerstfeest aan of uit. Op 25 december gaat
het automatisch aan, volgens de kalender in Europe/Brussels. De knop werkt ook
op andere dagen. `?party=1` forceert het feest; `?party=0` schakelt de automatische
start voor die pagina uit.

De Sterrenstraat krijgt 680 extra lichtjes, hangende sterren, een feestbanier
en warme verlichting. **Bekijk feeststraat** brengt je rechtstreeks bij de
winkels. Er komen 36 extra bewoners bij, waaronder 20 dansers, en zes afwisselende
vuurwerkshows met 816 vonken boven het dorp. De snellere feestwals begint na de
intro; de geluidsknop dempt zowel muziek als vuurwerk. De feestmuziek wordt
lokaal opgebouwd en heeft geen externe audiobestanden nodig.

Bij een voorkeur voor minder beweging blijven de feestlichten en vuurwerksterren
stil staan en klinken er geen vuurwerkknallen. Uitschakelen herstelt de gewone
scène en stopt de feestmuziek; opnieuw inschakelen hergebruikt de bewoners.

`index.html` bevat het oorspronkelijke diorama en de renderlus;
`village.js` voegt het dorp, materialen, verlichting en verkenningsmodi toe.
`forest.js` levert sparren met afzonderlijke naalden en drie detailniveaus;
`residents.js` animeert tien elfenvarianten met verschillende huidtinten,
kleding en rollen. `navigation.js` deelt botsingsdetectie tussen wandelaars.
`microvoxels.js` bouwt alleen de zichtbare vlakken van fijne voxels van
12,5 cm, vier keer kleiner dan de oorspronkelijke cellen van 50 cm.
Contactschaduwen, materiaalocclusie en SSAO geven diepte onder bomen en
langs gevels. De huizen hebben rokende schoorstenen en fijne geveldetails. Hun afmetingen,
daklijnen, dakkapellen en veranda’s variëren deterministisch per adres.
`winter-landscape.js` vormt één doorlopend sneeuwlandschap met onregelmatige,
door de wind gevormde duinen en subtiele gouden lichtdeeltjes rond het plein.
`storybook-details.js` voegt 108 papieren sterren, fijne dennenguirlandes,
vensteruitstallingen, speelgoed, kaarsen en kleine bewoonde hoekjes toe.

De intro duurt 32 seconden: vanuit de ruimte naar de aarde, inzoomen op
de Noordpool en afdalen onder het noorderlicht naar het dorp.
Het poollicht is vanaf het eerste ruimtebeeld zichtbaar: drie gebogen gordijnen
volgen de poolkap en gaan tijdens de afdaling geleidelijk over in het lokale
poollicht. `polar-aurora.js` voegt hiervoor drie tekenopdrachten toe.
De aardbol en het echte dorp delen dezelfde 3D-wereld: de camera daalt zonder
scènewissel of witte overgang af naar de straten. De Noordpool ligt in de nacht;
de verlichte huizen zijn al vanuit de ruimte zichtbaar. De schaal is bewust
sprookjesachtig om het dorp leesbaar te houden. `space-intro.js` gebruikt lokale
aard-, stadslicht- en wolkentexturen met bronvermelding
in `assets/earth-source.txt`. `?t=8` bevriest bijvoorbeeld de poolzoom;
`window.seekIntro(seconden)` verplaatst de ontwikkeltijdlijn deterministisch.
`intro-music.js` bevat een originele kerstwals van 32 seconden met een
celestamelodie, getokkelde akkoorden, arpeggio’s en zachte sleebelletjes. De
stereomuziek wordt eenmaal lokaal opgebouwd met Web Audio en volgt de volledige
intro, inclusief de ruimtebeelden. Er zijn geen doorlopende drones. Als de
browser automatisch geluid blokkeert, staat er **Start muziek** op de geluidsknop.
Overslaan stopt de muziek; opnieuw afspelen begint bij de eerste maat.

Vaste geometrie wordt per materiaal samengevoegd. De renderresolutie,
sneeuw en schaduwkwaliteit worden bij lage framesnelheden verminderd.
De wereld heeft een gedetailleerde, gestileerde uitstraling; de geometrie
is geen fotorealistische scan.

## Browsercontroles in de cloudomgeving

De omgevingsinstallatie plaatst Playwright 1.62.1 buiten de checkout.
Start eerst de server hierboven, voer daarna uit:

```sh
node --test _check/navigation_test.mjs
NODE_PATH=/workspace/santa-browser-tools/node_modules node _check/village_smoke.cjs
NODE_PATH=/workspace/santa-browser-tools/node_modules node _check/intro_test.cjs
node _check/export.cjs --output /tmp/santa-export/winterdorp.html
NODE_PATH=/workspace/santa-browser-tools/node_modules SANTA_HTML=/tmp/santa-export/winterdorp.html node _check/aurora_music_test.cjs
```

De test controleert rendering, rondleiding, lopen en botsingen, vliegen,
stijgen/dalen, terugkeren, de oorspronkelijke binnenweergave, het cadeau,
geluid en mobiele bediening. Screenshots komen in `/tmp/santa-village-checks`;
`SANTA_TEST_OUTPUT` kan een andere uitvoermap instellen.
`SANTA_BASE_URL` kan een alternatieve lokale testserver selecteren. `CHROMIUM_PATH`
kan het standaardpad `/usr/bin/chromium` vervangen.

De cloudtest haalt CDN-modules via `curl` met de bestaande proxy en CA-bundel
op, met TLS-controle ingeschakeld. Dat vermijdt wijzigingen aan Chromium’s
certificaatopslag. Software-WebGL kan langzaam zijn; deze controles meten
geen prestaties op een fysieke GPU. De oudere tests gebruiken een vast
macOS Brave-pad en schrijven naar bestaande screenshots; voer die niet
ongewijzigd op Linux uit.

## Eén bestand om lokaal te openen

De export bundelt Three.js, de scène en de lokale afbeeldingen in één HTML-bestand:

```sh
node _check/export.cjs --output /tmp/santa-export/winterdorp.html
```

Open `winterdorp.html` daarna rechtstreeks in een recente browser met WebGL2.
Er is voor dit bestand geen lokale server of internetverbinding nodig.
Zonder `--output` gebruikt het script hetzelfde pad als hierboven.

De exporttool gebruikt `esbuild` 0.25.12 en `three` 0.187.0 uit de aparte
toolmap `/workspace/santa-export/node_modules`. `SANTA_EXPORT_TOOLS` kan een
andere toolmap selecteren. Afbeeldingen die lokale modules laden via
`new URL('./assets/...', import.meta.url).href` worden als data-URL ingebed;
dit omvat ook nieuwe JPEG- en PNG-bestanden voor de ruimte-intro.
