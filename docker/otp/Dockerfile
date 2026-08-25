# Image OTP d'UrbanFlow — OpenTripPlanner officiel + notre entrypoint.
#
# Pourquoi une image dérivée plutôt que l'image officielle telle quelle :
# l'entrypoint d'origine se contente de lancer OTP avec les arguments reçus.
# Nous voulons en plus (recette UF-301) que `docker compose up` suffise :
# l'entrypoint doit décider seul s'il faut construire le graphe ou simplement
# le recharger depuis le volume persistant. Copier le script dans l'image
# (plutôt que le bind-monter) évite aussi les problèmes de bit d'exécution
# perdu sur un hôte Windows/NTFS.
ARG OTP_VERSION=2.7.0
FROM opentripplanner/opentripplanner:${OTP_VERSION}

COPY entrypoint.sh /urbanflow-entrypoint.sh
RUN chmod +x /urbanflow-entrypoint.sh

ENTRYPOINT ["/urbanflow-entrypoint.sh"]
