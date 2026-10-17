/**
 * Command identifiers.
 *
 * Commands are addressed by a stable number rather than by their position in the
 * interface. That indirection is what lets language packs, toolbars and shortcuts
 * all refer to the same command without agreeing on layout — a design input taken
 * from the REA findings and re-implemented here from scratch.
 */
export const CMD = {
  Open: 1001,
  Sidebar: 1002,

  PrevPage: 1010,
  NextPage: 1011,
  FirstPage: 1012,
  LastPage: 1013,

  ZoomOut: 1020,
  ZoomIn: 1021,
  FitWidth: 1022,
  FitPage: 1023,

  Rotate: 1030,

  Find: 1040,
  FindNext: 1041,
  FindPrev: 1042,
  FindClose: 1043,

  ToolHand: 1050,
  ToolSelect: 1051,
  ToolZoom: 1052,
  ToolSnapshot: 1053,

  TabThumbnails: 1060,
  TabOutline: 1061,
  TabAnnotations: 1062,

  // Selection
  ToolPointer: 1054,

  // Annotations
  AnnotHighlight: 1100,
  AnnotUnderline: 1101,
  AnnotStrikeout: 1102,
  AnnotInk: 1103,
  AnnotNote: 1104,
  AnnotRect: 1105,
  AnnotEllipse: 1109,
  AnnotArrow: 1110,
  AnnotTextbox: 1111,
  AnnotCallout: 1112,
  AnnotToggleVisible: 1113,
  AnnotMeasureDistance: 1115,
  AnnotMeasurePerimeter: 1116,
  AnnotMeasureArea: 1117,
  AnnotExportPage: 1114,
  AnnotDelete: 1106,
  AnnotClearPage: 1107,
  AnnotPanel: 1108,

  // View
  ViewContinuous: 1120,
  ViewSingle: 1121,
  ViewSpread: 1122,
  ViewFullscreen: 1123,
  DocProperties: 1124,

  // File
  SaveAnnotations: 1130,
  Undo: 1150,
  Redo: 1151,
ZoomActual: 1200,
  FitVisible: 1201,
  ZoomTo: 1202,
  ViewSpreadContinuous: 1203,
  PrevView: 1204,
  NextView: 1205,
  GoToPage: 1206,
Loupe: 1220,
  Print: 1221,
DeletePages: 1240,
  RotatePages: 1241,
  InsertBlankPage: 1242,
  ExtractPages: 1243,
  CropPages: 1244,
  SaveIntoPdf: 1140,
  ExportAnnotations: 1131,
  OpenRecent: 1132,
  CloseFile: 1133,
  Exit: 1134,

  About: 1090,
  UiLanguage: 1091,
  Settings: 1092,
} as const;

export type CommandId = (typeof CMD)[keyof typeof CMD];

/** Dialog identifiers, addressed the same way as commands. */
export const DIALOG = {
  About: 200,
  DocProperties: 210,
  Settings: 220,
} as const;

/** Control identifiers inside the About dialog. */
export const ABOUT_ITEM = {
  Ok: 1,
  Product: 2,
  Engine: 3,
} as const;

/** Control identifiers inside the document-properties dialog. */
export const PROPS_ITEM = {
  Ok: 1,
  FileName: 2,
  PageCount: 3,
  PageSize: 4,
  Version: 5,
  Producer: 6,
  Annotations: 7,
} as const;
