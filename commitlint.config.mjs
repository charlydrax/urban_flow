// Convention de commits (Conventional Commits) — UF-008, contrainte C3.
// Vérifiée automatiquement par le hook Git `commit-msg` (Husky + commitlint).
// Format attendu : type(scope facultatif): sujet — ex. `feat(api): add health endpoint (UF-005)`
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Le corps peut contenir des lignes longues (URLs, sorties de commandes)
    'body-max-line-length': [0],
  },
};
