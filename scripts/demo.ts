/** Fictional cellar for /demo/. Years are relative to the build year, so every status always shows. */
export function demoCsv(y: number): string {
  const rows: (string | number)[][] = [
    ["Vin", "Millésime", "Quantité", "Couleur", "Région", "Boire dès", "Boire avant", "Accords", "Notes"],
    ["Domaine de la Démo - Cuvée Prestige", y - 8, 3, "Rouge", "Bordeaux", y - 4, y - 1, "Viande rouge & grillades, Plat mijoté & gibier, Fromage", "Exemple fictif · Carafer 1 h · Servir à 17 °C"],
    ["Champagne Exemple - Brut Réserve", "", 2, "Bulles", "Champagne", "", y, "Apéro, Fruits de mer", "Exemple fictif · Servir à 8 °C"],
    ["Clos Fictif - Chablis 1er Cru", y - 3, 6, "Blanc", "Bourgogne", y - 1, y + 3, "Fruits de mer, Poisson, Fromage", "Exemple fictif · Servir à 11 °C"],
    ["Domaine Témoin - Morgon", y - 2, 5, "Rouge", "Beaujolais", y - 1, y + 4, "Volaille & viande blanche, Charcuterie & cuisine italienne, Végétarien", "Exemple fictif"],
    ["Mas Imaginaire - Rosé", y - 1, 4, "Rosé", "Provence", "", y + 1, "Apéro, Épicé & cuisine du monde", "Exemple fictif · Bien frais"],
    ["Vignoble Exemple - Vouvray moelleux", y - 5, 2, "Blanc", "Loire", y - 2, y + 15, "Épicé & cuisine du monde, Fromage, Dessert", "Exemple fictif"],
    ["Château Modèle - Grand Vin", y - 2, 6, "Rouge", "Rhône", y + 3, y + 12, "Viande rouge & grillades, Plat mijoté & gibier", "Exemple fictif · À oublier en cave"],
    ["Cave Inconnue - Riesling", "", 1, "Blanc", "Alsace", "", "", "Poisson, Épicé & cuisine du monde", "Exemple fictif · Millésime à compléter"],
    ["Domaine Passé - Côtes du Rhône", y - 5, 0, "Rouge", "Rhône", y - 3, y + 1, "Viande rouge & grillades", "Exemple fictif"],
  ];
  const cell = (v: string | number): string => {
    const t = String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\n");
}
