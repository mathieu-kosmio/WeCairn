.PHONY: dev verify-user test

## Télécharger PocketBase dans .local/ si besoin et lancer le serveur de dev (http://127.0.0.1:8090)
dev:
	@./scripts/pb.sh

## Marquer un compte membre comme vérifié en local, sans e-mail (usage : make verify-user EMAIL=prenom@entreprise.fr)
verify-user:
	@./scripts/verify-user.sh "$(EMAIL)"

## Lancer les tests (instance PocketBase jetable + node --test tests/)
test:
	@./scripts/test.sh
