# ⚡ USD Flash Terminal — Ultra Low-Latency Economic Squawk

Interface web conçue pour les traders de devises (USD, FX, Futures, Indices) nécessitant un accès immédiat et sans latence aux annonces macroéconomiques américaines (NFP, CPI, PPI, FOMC, Chômage).

Elle résout le problème de saturation et de latence rencontré sur des sites comme *Investing.com* ou *ForexFactory* lors des sorties de chiffres à 14h30 (Paris) / 08h30 (New York).

---

## 🚀 Caractéristiques & Architecture

1. **Diffusion WebSockets en temps réel (< 5 ms)** :
   - Zéro rafraîchissement manuel de page.
   - Les résultats sont poussés instantanément du serveur vers le navigateur.
2. **Intégration Massive.com (`MASSIVE_API_KEY`)** :
   - **Flux de dépêches direct** : actualités financières et macroéconomiques en temps réel avec filtrage intelligent USD/Fed.
   - **Indicateurs officiels Federal Reserve** : Marché du travail (`/fed/v1/labor-market`), Inflation CPI/PCE (`/fed/v1/inflation`), Courbe des taux US Treasury (`/fed/v1/treasury-yields`).
3. **Audio Squawk Local (Zéro latence audio)** :
   - Synthèse vocale instantanée exécutée localement dans le navigateur dès l'arrivée du résultat (*ex: « Flash: US Non-Farm Payrolls actual 255K vs 180K forecast. Massive beat. Bullish Dollar. »*).
4. **Flash Visuel Grand Écran (Peripheral Flash)** :
   - Flash plein écran vert (🟢 Beat / Bullish USD) ou rouge (🔴 Miss / Bearish USD) pour capter le regard du trader même si ses yeux sont fixés sur TradingView ou son carnet d'ordres.
5. **Horloges de précision & Compte à rebours milliseconde** :
   - Heure de New York (Wall St) et UTC synchronisées.
   - Compte à rebours haute précision vers la prochaine publication majeure.
6. **Boutons de Simulation de Test** :
   - Permet de tester immédiatement le flash visuel et la voix (NFP Beat, NFP Miss, CPI Hot, CPI Cool) pour calibrer son setup avant les vraies annonces.

---

## 🛠️ Démarrage Rapide

### 1. Clé d'API Massive
La variable d'environnement `MASSIVE_API_KEY` est détectée automatiquement depuis votre environnement Windows ou via un fichier `.env`.

### 2. Lancement du serveur

```bash
npm install
npm run dev        # compile le CSS Tailwind v4 puis lance le serveur
# npm run watch:css (dans un 2e terminal) pendant l'édition du design
```

> Le design system source est `src/ui/input.css` (Tailwind v4, tokens `@theme`). `public/style.css` est **généré** et versionné pour que GitHub Pages / Vercel le servent sans étape de build. Après toute modification de classes dans `public/index.html` ou `public/app.js`, relancer `npm run build:css`.
>
> Raccourcis clavier : `1`–`4` simulations, `M` coupe/active le squawk, `/` recherche dans les dépêches, `↑`/`↓` + `Entrée` sur le calendrier pour épingler un événement dans le panneau principal.

Le terminal est immédiatement accessible dans votre navigateur sur :
👉 **http://localhost:3000**
