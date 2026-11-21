# 0007 Accès distant par Tailscale

Statut : acceptée le 20/11/2026 (décision D3). Remplace l'hypothèse Cloudflare Tunnel et Access de la spécification, section 13.

## Contexte

La PWA, son service worker, les notifications et les passkeys exigent HTTPS sur une adresse stable, et une passkey est liée à son domaine. Cloudflare déchiffrerait tout le trafic à sa frontière et exigerait un nom de domaine.

## Décision

- Tailscale est installé sur la machine Linux du domicile et sur les appareils de Mehdi.
- `tailscale serve` publie `127.0.0.1:3000` en HTTPS à l'adresse `job4me.‹réseau›.ts.net`, réservée aux appareils du réseau Tailscale. Funnel, qui publierait l'application sur Internet, n'est jamais activé.
- L'adresse est fixée (nom de la machine `job4me`, nom du réseau) avant d'enregistrer les passkeys définitives ; elle devient l'origine et le RP ID de la configuration locale.

## Conséquences

- Aucun port ouvert sur la box ; le chiffrement va de bout en bout.
- Il faut l'app Tailscale active pour ouvrir Job4me ; les notifications push arrivent sans elle.
- Si Job4me s'ouvre un jour à d'autres, un hébergement public sera choisi à ce moment-là.
