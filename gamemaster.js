// Gamemaster — gelegentliche Sprüche zwischen Runden, abhängig von Punktzahl.

const LEADER = [
  "[NAME] ist gerade unaufhaltsam — hast du nichts Besseres zu tun?",
  "[NAME] führt mit Abstand. Verstörend gut für jemand, der das hier spielt.",
  "[NAME], wenn du so weitermachst, brauchst du nen Therapeuten.",
  "[NAME] räumt ab wie Helene Fischer beim Schlagermove.",
  "Schon wieder [NAME]. Langsam wird's unheimlich.",
  "[NAME], lass den anderen auch mal eine Chance.",
  "[NAME] dominiert. Sind alle anderen krank?",
  "[NAME] punktet, als gäb's morgen kein Bürgergeld mehr.",
  "[NAME] führt — mehrheitsfähig wie die CDU 2005.",
  "[NAME] hat einen Lauf. Aber irgendwann kommt der Knick.",
  "[NAME] siegt. Andere haben ein Sozialleben.",
  "[NAME] gewinnt schon wieder. Wer hat dich eingeladen?",
];

const LAST = [
  "[NAME] hat 0 Punkte. Mama hätte mehr Aufmerksamkeit schenken sollen.",
  "[NAME], hast du eigentlich verstanden, wie das hier geht?",
  "[NAME], dein Humor liegt heute zwischen Friedhof und Finanzamt.",
  "[NAME], die anderen lassen dich auch mal gewinnen. Vielleicht.",
  "[NAME] braucht jetzt einen Schluck zum Selbstmitleid.",
  "[NAME], es ist okay zu verlieren. Oder doch nicht.",
  "[NAME] sammelt Erfahrungen. Punkte sammelt jemand anderes.",
  "[NAME], deine Karten sind in Ordnung. Du nicht.",
  "[NAME] spielt aus Höflichkeit mit. Weniger als das.",
  "[NAME], es gibt YouTube-Tutorials für Humor.",
  "Hat jemand [NAME] eingeladen? Niemand erinnert sich.",
  "[NAME] verfolgt einen sehr eigenen Spielansatz: nicht gewinnen.",
  "[NAME], du bist im Bremsen wirklich gut.",
];

const TIE_TOP = [
  "[NAMES] liegen gleichauf. Dramatisch.",
  "Kopf-an-Kopf zwischen [NAMES] — wer ist der schlimmere Mensch?",
  "[NAMES] kämpfen um die Krone. Welch Spannung.",
  "[NAMES] teilen sich die Spitze. Wahrscheinlich aus Versehen.",
  "[NAMES] sind gleichauf. Ein Spiel der Verlierer.",
];

const GENERIC = [
  "Pause. Trinkt was. Reflektiert eure Lebensentscheidungen.",
  "Diese Runde war... mutig.",
  "Erinnerung: das alles hier ist freiwillig.",
  "Ein Mensch mit Selbstwert würde das Spiel jetzt verlassen.",
  "Wer hat das eigentlich erfunden?",
  "Schöne Runde. Schade, dass eure Nachbarn alles mithören.",
  "Ich glaube, jemand sollte mal seine Mutter anrufen.",
  "Der Therapeut von übermorgen freut sich schon.",
  "Es gibt definitiv bessere Hobbys.",
  "Wenn das auf einer Beerdigung wäre, würden wir alle gehen.",
  "Ihr seid alle nicht zu retten. Aber das wisst ihr schon.",
  "Eine Runde Schweigen für eure Lebenswahl.",
  "Wenigstens trinken wir alle dasselbe.",
];

const BIG_LEAD = [
  "[NAME] zieht davon. Der Rest sollte sich Gedanken machen.",
  "[NAME] dominiert. Die anderen sind jetzt offiziell Statisten.",
  "[NAME] gewinnt. Im Geist sind die anderen schon zu Hause.",
  "[NAME] hat das hier verstanden. Die anderen sind dekorativ.",
  "[NAME] zerlegt die Konkurrenz wie Lauterbach die Krankenkasse.",
  "[NAME] führt unverschämt deutlich. Beleidigung der Restmannschaft.",
];

const FIRST_POINT = [
  "Endlich — [NAME] hat den ersten Punkt. Gratulation, das war knapp.",
  "[NAME] hat tatsächlich gepunktet. Wer hätte das gedacht.",
  "Großer Moment für [NAME]: erster Punkt. Bitte ein Foto.",
];

const ALL_ZERO = [
  "Niemand hat einen Punkt. Macht weiter so, das hat Stil.",
  "Beste Punktzahl-Symmetrie aller Zeiten: 0:0:0...",
  "Niemand führt. Niemand verliert. Niemand spielt anständig.",
];

const VOTE_TIE = [
  "Unentschieden. Niemand wollte sich entscheiden — typisch deutsch.",
  "Pattsituation. Demokratie hat verloren.",
  "Gleichstand bei den Stimmen. Klassisch peinlich.",
];

const NO_VOTES = [
  "Niemand hat gewählt. Ich auch nicht.",
  "0 Stimmen. Das ist neu.",
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Wahrscheinlichkeit, dass ein Spruch erscheint (sonst null)
const FIRE_PROBABILITY = 0.45;

function generateMessage(players, winner, lastWinnerId) {
  const active = players.filter(p => p.connected);
  if (active.length < 2) return null;

  // Spezielle, wahrscheinlichere Trigger:
  if (winner && winner.tied && Math.random() < 0.7) return pick(VOTE_TIE);
  if (winner && winner.none && Math.random() < 0.85) return pick(NO_VOTES);

  // Sonst nur gelegentlich
  if (Math.random() > FIRE_PROBABILITY) return null;

  const sorted = [...active].sort((a, b) => b.score - a.score);
  const max = sorted[0].score;
  const min = sorted[sorted.length - 1].score;
  const leaders = sorted.filter(p => p.score === max);
  const lastPlace = sorted.filter(p => p.score === min);

  // Alle bei 0
  if (max === 0) return pick(ALL_ZERO);

  // Erster Punkt überhaupt
  if (max === 1 && winner && !winner.tied && !winner.none) {
    const winnerPlayer = active.find(p => p.name === winner.playerName);
    if (winnerPlayer && winnerPlayer.score === 1 && Math.random() < 0.5) {
      return pick(FIRST_POINT).replace('[NAME]', winnerPlayer.name);
    }
  }

  // Großer Vorsprung (≥3 vor zweitem)
  if (leaders.length === 1 && sorted.length > 1) {
    const second = sorted[1].score;
    if (max - second >= 3 && Math.random() < 0.6) {
      return pick(BIG_LEAD).replace('[NAME]', leaders[0].name);
    }
  }

  // Patt an der Spitze (mehrere mit max > 0)
  if (leaders.length >= 2 && max > 0 && Math.random() < 0.5) {
    const names = leaders.map(p => p.name).join(' und ');
    return pick(TIE_TOP).replace('[NAMES]', names);
  }

  // Würfel: Leader-Spruch, Last-Spruch oder generisch
  const r = Math.random();
  if (r < 0.35 && leaders.length === 1) {
    return pick(LEADER).replace('[NAME]', leaders[0].name);
  }
  if (r < 0.65 && min === 0 && lastPlace.length === 1 && max > 0) {
    return pick(LAST).replace('[NAME]', lastPlace[0].name);
  }
  return pick(GENERIC);
}

module.exports = { generateMessage };
