/* ------------------------------------------------------------------ */
/* Shared subject detection.                                            */
/* Decides whether a topic is STEM/technical (formulas + code allowed)  */
/* or humanities-style (prose, images, diagrams only).                  */
/* Used by both the SlideTool UI chip and the server-side generators    */
/* so the badge and the deck always agree.                              */
/* ------------------------------------------------------------------ */

export const STEM_RE =
  new RegExp(
    [
      // math
      "math", "algebra", "calculus", "geometr", "trigonometr", "statistic", "probabilit", "theorem", "equation",
      // physics & space
      "physic", "mechanic", "kinemat", "dynam", "thermodynam", "energy", "momentum", "\\bforce", "velocity",
      "acceler", "newton", "quantum", "particle", "relativit", "optic", "magnet", "electric", "circuit",
      "astronom", "astrophys", "cosmolog", "planetar",
      // chemistry
      "chem", "molecul", "\\batom", "periodic table", "isotope",
      // biology & life sciences (mycology, botany, medicine, ...)
      "biolog", "mycolog", "fung(?:us|i|al)", "botan", "zoolog", "ecolog", "genetic", "genom", "microb",
      "bacteri", "virolog", "\\bvirus", "anatom", "physiolog", "neuro", "immunolog", "evolut", "organism",
      "patholog", "biochem", "epidemiolog", "\\bcell(?:s|ular)?\\b", "enzym", "photosynthe",
      // earth science
      "geolog", "meteorolog", "oceanograph", "seismolog", "mineralog",
      // computing & engineering
      "program", "\\bcode", "coding", "algorithm", "engineer", "software", "comput", "machine learn",
      "neural net", "robot", "database", "cryptograph",
      // catch-all: "science", "scientific", "data science", ...
      "\\bscien",
    ].join("|"),
    "i",
  );

/** True when the topic should get formulas/code (STEM), false → humanities styling. */
export function isStemTopic(topic: string): boolean {
  return STEM_RE.test(topic);
}
