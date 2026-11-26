// Scene manifest: render.mjs parses the quoted ids in SCENES, so keep it a plain string array.
const SCENES = [
  'hero',
  'form-architect',
  'logic-machine',
  'information-structure',
  'perfect-structure',
  'components',
  'precision',
  'workflow-continuum',
  'engineering',
  'integrations',
  'open-by-design',
  'deployment',
];
SCENES.forEach((n) => document.write('<script src="scenes/' + n + '.js"><\/script>'));
