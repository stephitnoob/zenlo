/*
  Zenlo – trình quản lí hội thoại Zalo

  Everything that runs in Zalo's page, bundled into dist/zenlo.js. Order matters: the stylesheet
  guard first, then the core (window.ZenloCore), then the features that use it.
*/

import './styles.js'
import './core.js'
import './summary.js'
import './digest.js'
import './settings.js'
