# W.S.P voor iPhone

**Je cijfers, rooster en huiswerk van school in één overzichtelijke app, en nieuwe cijfers open je als een pakje.**

W.S.P is een onofficiële app van een leerling. Hij staat niet in de App Store, maar je kunt hem **gratis** op je iPhone zetten met **SideStore**. Dat kost één keer ongeveer 20 minuten; daarna heb je je computer niet meer nodig.

**[⬇ Download W.S.P (WSP.ipa)](https://github.com/wesssaa/W.S.P-iPhone/releases/latest/download/WSP.ipa)**

> Heb je Android? Kijk dan bij [W.S.P voor Android](https://github.com/wesssaa/Ichthus-Plus).

---

## Wat heb je nodig

- Een **iPhone met iOS 15 of nieuwer**, met een toegangscode (de widget werkt vanaf iOS 16)
- Eén keer een **computer**: Windows (64-bit) of een Mac
- Een **USB-kabel** voor je iPhone
- Een **Apple ID** (gratis; een tweede Apple ID speciaal hiervoor mag ook)
- **Wifi** (4G/5G werkt niet voor het installeren)

## Installeren in 5 stappen

### Stap 1 · Op je iPhone: LocalDevVPN

1. Installeer **[LocalDevVPN uit de App Store](https://apps.apple.com/app/localdevvpn/id6755608044)**.
2. Open hem en tik op **Connect**. Vraagt hij om een VPN toe te voegen, tik dan op **Sta toe** en vul je toegangscode in.

Deze "VPN" werkt alleen binnen je eigen telefoon: er gaat niks via internet naar iemand anders. Laat hem gewoon aan staan.

### Stap 2 · Op je computer: iTunes en iloader

**Windows**
1. Installeer **[iTunes, rechtstreeks van Apple](https://www.apple.com/itunes/download/win64)** (die werkt het best; de versie uit de Microsoft Store kan ook).
2. Download **[iloader (MSI)](https://github.com/nab138/iloader/releases/latest/download/iloader-windows-x64.msi)** en installeer hem.

**Mac**
- Download **[iloader voor Mac](https://github.com/nab138/iloader/releases/latest/download/iloader-darwin-universal.dmg)** (iTunes is niet nodig).

> **Waarom iTunes?** Windows weet uit zichzelf niet hoe het via de kabel met een iPhone moet praten. iTunes installeert de stuurprogramma's van Apple die daarvoor nodig zijn. iloader gebruikt die om je iPhone te herkennen, SideStore erop te zetten en een "pairing file" te maken (zodat SideStore daarna zonder computer kan vernieuwen). Je hoeft iTunes zelf nooit te openen, hij moet er alleen op staan. Een Mac heeft dit al ingebouwd.

> **Mijn virusscanner zegt dat iloader een virus is?**
> Dat komt vaker voor: iloader is een onbekend programma dat met je iPhone praat, en dan slaan sommige virusscanners alarm. Wil je het zeker weten? Ga naar **[virustotal.com](https://www.virustotal.com)**, kies **File** en upload het gedownloade bestand. Daar controleren ruim 60 virusscanners het tegelijk. Geven er maar een paar onbekende scanners een melding, dan is het vrijwel zeker vals alarm.
> Download iloader alleen via de links hierboven (de officiële pagina van iloader op GitHub), nooit van een andere site.

### Stap 3 · SideStore op je iPhone zetten

1. Sluit je iPhone met de kabel aan op je computer. Tik op je iPhone op **Vertrouw** en vul je toegangscode in.
2. Open **iloader** en log in met je **Apple ID** (let op hoofdletters).
3. Kies je iPhone en tik op **Install SideStore (Stable)**.
4. Op je iPhone: **Instellingen → Algemeen → VPN en apparaatbeheer** → tik op je Apple ID → **Vertrouw** (→ Sta toe en herstart).
5. **Instellingen → Privacy en beveiliging** → helemaal onderaan **Ontwikkelaarsmodus** aanzetten. Je iPhone herstart; bevestig daarna met **Zet aan**.
6. Zorg dat **LocalDevVPN** aan staat (Connect), open **SideStore** en log in met **hetzelfde Apple ID**.
7. Ga naar **My Apps** en tik op **7 DAYS** naast SideStore. Vraagt hij om een certificaat, tik dan op **Yes** / **Refresh Now**. SideStore sluit even en is na een paar seconden weer klaar.

Kom je ergens niet uit? De officiële uitleg staat op **[docs.sidestore.io](https://docs.sidestore.io/docs/installation/prerequisites)**.

### Stap 4 · W.S.P installeren

1. Open op je iPhone in Safari: **[WSP.ipa downloaden](https://github.com/wesssaa/W.S.P-iPhone/releases/latest/download/WSP.ipa)** en kies **Download**.
2. Open **SideStore → My Apps** en tik linksboven op **+**.
3. Kies **WSP.ipa** (bij Downloads in Bestanden). Na een paar seconden staat W.S.P op je beginscherm.
4. Open W.S.P en log in met je schoolaccount. De app loopt de eerste stappen met je door.

### Stap 5 · Automatisch vernieuwen (verplicht)

Met een gratis Apple ID werkt een app 7 dagen; daarna moet SideStore hem vernieuwen. Laat dat 's nachts vanzelf gebeuren met de app **Opdrachten**:

1. **Automatisering → + → Tijdstip**
2. **02:00**, Wekelijks, twee dagen aanvinken (bijv. maandag en donderdag) → **Voer direct uit** → Volgende
3. Zoek **SideStore** → **Refresh All Apps** → **Gereed**

Je telefoon moet om 02:00 aan staan, internet hebben en LocalDevVPN moet aan staan. In W.S.P zie je bij **Meer → Automatisch vernieuwen** hoeveel dagen hij nog werkt.

## Updates

W.S.P kijkt zelf of er een nieuwe versie is. Is die er, dan zie je **Nieuwe versie**: tik op **Nu bijwerken**, dan opent SideStore en tik je op **Installeren**. Je cijfers, reminders en instellingen blijven staan.

Liever updates in SideStore zelf zien? Voeg de bron toe: **SideStore → Sources → +** en plak
`https://github.com/wesssaa/W.S.P-iPhone/releases/latest/download/source.json`

## Problemen?

- **W.S.P opent niet meer** – de 7 dagen zijn om. Zet LocalDevVPN aan, open SideStore → My Apps en tik op het dagen-getal naast W.S.P.
- **SideStore zegt iets over een "pairing file"** – dat gebeurt soms na een iOS-update. Doe stap 3 dan nog een keer met iloader.
- **"Maximum number of apps"** – met een gratis Apple ID kun je maar 3 zelf geïnstalleerde apps tegelijk hebben (SideStore telt mee). Daarnaast mag je per week maar een paar nieuwe app-ID's aanmaken; W.S.P gebruikt er twee (de app en de widget).
- **Geen meldingen** – Instellingen → W.S.P → Berichtgeving → aanzetten. iOS bepaalt zelf hoe vaak de app op de achtergrond mag kijken (meestal een paar keer per dag).

## Wat zit erin

Hetzelfde als de Android-app: cijfers unboxen, alle cijfers per vak met "Wat moet ik halen?", je rooster uit Zermelo met uitval, huiswerk met herinneringen, eigen reminders, het rooster van een medeleerling, meldingen, een widget (ook op je toegangsscherm) en wit of zwart met je eigen accentkleur.

## Privacy

- Je logt in via de gewone schoolinlog (Microsoft). De app ziet en bewaart je wachtwoord niet. Op de inlogpagina verbergt hij alleen het logo van school en zet hij een algemene voorbeeldtekst in het e-mailveld.
- Je cijfers, rooster, huiswerk en reminders blijven alleen op je eigen iPhone.
- Geen advertenties, geen trackers. SideStore en iloader zijn programma's van anderen; W.S.P krijgt daar niks van te zien.

## Let op

W.S.P is een persoonlijk project van een leerling. De app is niet gemaakt door of namens je school of Zermelo, staat niet in de App Store en is niet door Apple gecontroleerd. Gebruik is op eigen risico; controleer belangrijke dingen altijd in het leerlingportaal of Zermelo.

---

## Voor ontwikkelaars

De iPhone-versie is een venster op het leerlingenportaal waar `app.js` (precies dezelfde als in de Android-app) zijn eigen scherm overheen zet.

- `IchthusPlus/` – de Swift-code: `WebViewController` (portaal laden), `Bridge` (`window.CijferApp` voor app.js), `ZermeloLogin`, `Agenda`, `Checker` + `Portal` + `Background` (achtergrondcontroles en meldingen), `Reminders` en `HomeworkReminders`, `Updates` (update-vakje via SideStore).
- `IchthusWidget/` – de widget "volgende les" (klein, middel en toegangsscherm).
- `web/` – app.js, lettertypes en plaatjes, gekopieerd uit de Android-app met `sync.ps1`.
- `project.yml` – het Xcode-project; GitHub Actions maakt er zelf een `.xcodeproj` van (geen Mac nodig).
- `.github/workflows/build.yml` – bouwt een niet-ondertekende `WSP.ipa`; SideStore ondertekent hem met je eigen Apple ID. Met `[sim]` in de commit ook een test in de iPhone-simulator.

```
.\iphone\sync.ps1
.\iphone\push.ps1 -Message "Wat er veranderd is" -Tag v0.2.0
```
