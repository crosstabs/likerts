import CoreGraphics

/// Bounds measured from untouched Image Gen atlases. Runtime crops preserve source pixels.
enum StoryPropBounds {
    static let pianoBench = CGRect(x: 59, y: 345, width: 1138, height: 707)
    /// Versioned, original six-cell transparent atlas. Bounds include a small
    /// antialias margin and stay inside their source cell.
    static let layerV1: [String: CGRect] = [
        "emptybento": CGRect(x: 58, y: 116, width: 443, height: 334),
        "bentorim": CGRect(x: 583, y: 299, width: 441, height: 139),
        "pancakesingle": CGRect(x: 1117, y: 160, width: 364, height: 270),
        "plateplain": CGRect(x: 48, y: 616, width: 464, height: 291),
        "postcardback": CGRect(x: 578, y: 605, width: 446, height: 319),
        "warmglow": CGRect(x: 1051, y: 515, width: 474, height: 477),
    ]
    /// The V2 artwork is not an exact 512-pixel grid: two sprites extend
    /// across grid seams into transparent gutters. Bounds follow real pixels.
    static let layerV2: [String: CGRect] = [
        "openbook": CGRect(x: 34, y: 127, width: 535, height: 309),
        "loosepage": CGRect(x: 628, y: 108, width: 377, height: 326),
        "redpuzzlepiece": CGRect(x: 1116, y: 65, width: 378, height: 383),
        "bluepuzzlepiece": CGRect(x: 65, y: 599, width: 408, height: 331),
        "curtainedwindow": CGRect(x: 571, y: 558, width: 470, height: 396),
        "singlecurtain": CGRect(x: 1212, y: 544, width: 212, height: 426),
    ]
    /// Poses are whole pictures with different aspect ratios. Playback must
    /// recheck the apparent contact point whenever one picture replaces another.
    static let layerV3: [String: CGRect] = [
        "dogattentive": CGRect(x: 82, y: 139, width: 394, height: 431),
        "catattentive": CGRect(x: 609, y: 118, width: 357, height: 433),
        "rabbitattentive": CGRect(x: 1132, y: 107, width: 322, height: 441),
        "dogresting": CGRect(x: 71, y: 617, width: 427, height: 316),
        "catresting": CGRect(x: 577, y: 634, width: 411, height: 300),
        "rabbitresting": CGRect(x: 1113, y: 623, width: 358, height: 316),
    ]
    /// Measured transparent sprite bounds from source atlas V4.
    static let layerV4: [String: CGRect] = [
        "cakewhole": CGRect(x: 65, y: 109, width: 409, height: 373),
        "cakemissing": CGRect(x: 575, y: 107, width: 421, height: 373),
        "slicenarrow": CGRect(x: 1176, y: 153, width: 263, height: 324),
        "slicewide": CGRect(x: 100, y: 558, width: 387, height: 374),
        "creamdetail": CGRect(x: 635, y: 597, width: 303, height: 317),
        "cakeserver": CGRect(x: 1064, y: 585, width: 430, height: 339),
    ]
    /// Measured transparent sprite bounds from source atlas V5.
    static let layerV5: [String: CGRect] = [
        "mixingbowlempty": CGRect(x: 58, y: 144, width: 438, height: 324),
        "whiskloose": CGRect(x: 634, y: 115, width: 314, height: 372),
        "batterpool": CGRect(x: 1064, y: 269, width: 412, height: 196),
        "toasterempty": CGRect(x: 50, y: 548, width: 448, height: 373),
        "toastslice": CGRect(x: 616, y: 561, width: 327, height: 351),
        "servingtray": CGRect(x: 1041, y: 654, width: 462, height: 240),
    ]
    /// Measured transparent sprite bounds from source atlas V6.
    static let layerV6: [String: CGRect] = [
        "puddle": CGRect(x: 95, y: 204, width: 415, height: 226),
        "splash": CGRect(x: 633, y: 168, width: 280, height: 232),
        "snowpatch": CGRect(x: 1041, y: 211, width: 455, height: 233),
        "mudpath": CGRect(x: 84, y: 561, width: 414, height: 328),
        "tidypath": CGRect(x: 574, y: 545, width: 414, height: 342),
        "flatscarf": CGRect(x: 1044, y: 598, width: 460, height: 281),
    ]
    /// Measured transparent sprite bounds from source atlas V7.
    static let layerV7: [String: CGRect] = [
        "cottagepurple": CGRect(x: 74, y: 81, width: 390, height: 433),
        "cottagecoral": CGRect(x: 574, y: 63, width: 400, height: 451),
        "cottageblue": CGRect(x: 1059, y: 64, width: 405, height: 454),
        "porch": CGRect(x: 87, y: 556, width: 364, height: 392),
        "stationpod": CGRect(x: 507, y: 646, width: 520, height: 298),
        "gardendome": CGRect(x: 1096, y: 559, width: 381, height: 401),
    ]
    /// V8 source includes a provisional split clapper. Geometry remains subject
    /// to native playback review; the other four pieces are not in production.
    static let layerV8: [String: CGRect] = [
        "clapperbody": CGRect(x: 40, y: 174, width: 408, height: 256),
        "clapperbar": CGRect(x: 480, y: 198, width: 428, height: 166),
    ]
    /// V9 separate objects are provisional until native playback review.
    static let layerV9: [String: CGRect] = [
        "moviereel": CGRect(x: 200, y: 70, width: 450, height: 440),
        "popcornsingle": CGRect(x: 852, y: 146, width: 380, height: 345),
        "projectorbeam": CGRect(x: 764, y: 575, width: 605, height: 455),
    ]
    /// V11 source keeps ingredients as separate rigid crops; contact requires playback review.
    static let layerV11: [String: CGRect] = [
        "snackscoop": CGRect(x: 89, y: 118, width: 437, height: 384),
        "snackbowl": CGRect(x: 590, y: 174, width: 409, height: 317),
        "snackkernels": CGRect(x: 1107, y: 165, width: 334, height: 298),
        "snackpretzelbits": CGRect(x: 616, y: 565, width: 379, height: 362),
    ]
    /// Six separate contextual tableaux, cropped from the unchanged original sheet.
    static let layerV12: [String: CGRect] = [
        "cutcake": CGRect(x: 0, y: 0, width: 512, height: 512),
        "platedcakeslice": CGRect(x: 512, y: 0, width: 512, height: 512),
        "puzzlegap": CGRect(x: 1024, y: 0, width: 512, height: 512),
        "handmadepawn": CGRect(x: 0, y: 512, width: 512, height: 512),
        "crookedparcel": CGRect(x: 512, y: 512, width: 512, height: 512),
        "nestedboxes": CGRect(x: 1024, y: 512, width: 512, height: 512),
    ]
    /// Original food detail sheet; rigid-only crops, not articulated actions.
    static let layerV13: [String: CGRect] = [
        "tinyfork": CGRect(x: 110, y: 110, width: 322, height: 337),
        "pinkdrip": CGRect(x: 638, y: 90, width: 274, height: 364),
        "cookiehalf": CGRect(x: 1095, y: 124, width: 349, height: 327),
        "pretzelsections": CGRect(x: 70, y: 542, width: 430, height: 406),
        "fruitsticker": CGRect(x: 658, y: 635, width: 223, height: 212),
        "forkbowl": CGRect(x: 1086, y: 552, width: 387, height: 369),
    ]
    /// Blank flat-front props; native labels are independently sized and accessible text stays in the prompt.
    static let layerV14: [String: CGRect] = [
        "openinvite": CGRect(x: 0, y: 0, width: 660, height: 627),
        "scoreplacard": CGRect(x: 660, y: 0, width: 594, height: 627),
        "labelgamebox": CGRect(x: 0, y: 627, width: 660, height: 627),
        "craftpaper": CGRect(x: 660, y: 627, width: 594, height: 627),
    ]
    /// Original transparent world props, reviewed as crops; staging awaits native review.
    static let layerV16: [String: CGRect] = [
        "worldleaf": CGRect(x: 0, y: 0, width: 512, height: 512),
        "worldmudboots": CGRect(x: 512, y: 0, width: 512, height: 512),
        "worldfoldedtent": CGRect(x: 1024, y: 0, width: 512, height: 512),
        "worldtentpegs": CGRect(x: 0, y: 512, width: 512, height: 512),
        "worldpawtrail": CGRect(x: 512, y: 512, width: 512, height: 512),
        "worldpatternumbrella": CGRect(x: 1024, y: 512, width: 512, height: 512),
    ]
    /// Crops from original style and making sheets; still contexts, not articulated props.
    static let layerV23: [String: CGRect] = [
        "socialSockBundles": CGRect(x: 0, y: 0, width: 768, height: 520),
        "socialWornCap": CGRect(x: 768, y: 0, width: 768, height: 520),
    ]
    static let layerV24: [String: CGRect] = [
        "socialRulerStrips": CGRect(x: 0, y: 0, width: 768, height: 471),
        "socialCardboardRobot": CGRect(x: 0, y: 471, width: 768, height: 553),
        "socialMendedMug": CGRect(x: 768, y: 471, width: 768, height: 553),
    ]
    static let props: [String: CGRect] = [
        "bowl": CGRect(x: 42, y: 105, width: 311, height: 241),
        "loosepopcorn": CGRect(x: 412, y: 57, width: 287, height: 306),
        "necklace": CGRect(x: 758, y: 76, width: 297, height: 270),
        "napkin": CGRect(x: 1105, y: 84, width: 310, height: 262),
        "cushion": CGRect(x: 31, y: 454, width: 347, height: 210),
        "ball": CGRect(x: 453, y: 459, width: 206, height: 208),
        "brush": CGRect(x: 749, y: 410, width: 303, height: 269),
        "headphones": CGRect(x: 1102, y: 389, width: 317, height: 288),
        "recordplayer": CGRect(x: 38, y: 703, width: 333, height: 321),
        "trainseat": CGRect(x: 418, y: 708, width: 272, height: 313),
        "passport": CGRect(x: 767, y: 732, width: 271, height: 295),
        "ticket": CGRect(x: 1104, y: 764, width: 317, height: 231),
    ]

    static let sets: [String: CGRect] = [
        "table": CGRect(x: 27, y: 174, width: 429, height: 232),
        "box": CGRect(x: 478, y: 116, width: 409, height: 283),
        "window": CGRect(x: 915, y: 56, width: 403, height: 346),
        "curtain": CGRect(x: 1363, y: 35, width: 380, height: 374),
        "bench": CGRect(x: 29, y: 526, width: 441, height: 283),
        "path": CGRect(x: 524, y: 479, width: 368, height: 350),
        "recordrack": CGRect(x: 933, y: 523, width: 394, height: 290),
        "envelope": CGRect(x: 1368, y: 511, width: 372, height: 305),
    ]

    static let states: [String: CGRect] = [
        "raincoat": CGRect(x: 18, y: 197, width: 396, height: 433),
        "opensuitcase": CGRect(x: 458, y: 148, width: 344, height: 492),
        "recordsleeves": CGRect(x: 830, y: 224, width: 384, height: 397),
        "icecreambowl": CGRect(x: 1219, y: 226, width: 351, height: 407),
        "fruitface": CGRect(x: 1590, y: 283, width: 379, height: 322),
    ]

    /// Original integrated still illustrations, not animated sprite rigs.
    static let homeScenesV15: [String: CGRect] = [
        "homeUnderSofaV15": CGRect(x: 0, y: 0, width: 768, height: 512),
        "homeCushionV15": CGRect(x: 768, y: 0, width: 768, height: 512),
        "homeClockV15": CGRect(x: 0, y: 512, width: 768, height: 512),
        "homeBlanketV15": CGRect(x: 768, y: 512, width: 768, height: 512)
    ]
    static let integratedScenesV17: [String: CGRect] = [
        "slipperComparisonV17": CGRect(x: 0, y: 0, width: 768, height: 512),
        "pillowSpillV17": CGRect(x: 768, y: 0, width: 768, height: 512),
        "cushionFortV17": CGRect(x: 0, y: 512, width: 768, height: 512),
        "clockPlantStandV17": CGRect(x: 768, y: 512, width: 768, height: 512),
    ]

    static let integratedScenesV18: [String: CGRect] = [
        "slipperSearchV18": CGRect(x: 0, y: 0, width: 768, height: 512),
        "plantSofaV18": CGRect(x: 768, y: 0, width: 768, height: 512),
        "teaCosyV18": CGRect(x: 0, y: 512, width: 768, height: 512),
        "wonkyPancakeV18": CGRect(x: 768, y: 512, width: 768, height: 512),
    ]

    static let integratedScenesV19: [String: CGRect] = [
        "shirtCrumbV19": CGRect(x: 0, y: 0, width: 768, height: 512),
        "morningChecklistV19": CGRect(x: 768, y: 0, width: 768, height: 512),
        "sunriseCurtainV19": CGRect(x: 0, y: 512, width: 768, height: 512),
        "soakingBowlV19": CGRect(x: 768, y: 512, width: 768, height: 512),
    ]

    static let integratedScenesV22: [String: CGRect] = [
        "slipperThroneV22": CGRect(x: 0, y: 0, width: 768, height: 512),
        "slipperSofaTestV22": CGRect(x: 768, y: 0, width: 768, height: 512),
        "pillowFootrestV22": CGRect(x: 0, y: 512, width: 768, height: 512),
        "highWallClockV22": CGRect(x: 768, y: 512, width: 768, height: 512),
    ]

    /// Original media props and complete illustrations, staged as stills.
    static let layerV20: [String: CGRect] = [
        "mediaGuitarInStand": CGRect(x: 105, y: 32, width: 367, height: 510),
        "mediaPickOnSleeve": CGRect(x: 550, y: 139, width: 450, height: 383),
        "mediaHeadphonesInCase": CGRect(x: 1040, y: 64, width: 482, height: 452),
        "mediaSweaterSketch": CGRect(x: 51, y: 566, width: 458, height: 393),
        "mediaMessySuppliesSketch": CGRect(x: 529, y: 571, width: 503, height: 389),
        "mediaCreatureBrushHolder": CGRect(x: 1085, y: 534, width: 429, height: 441),
    ]
    static let integratedScenesV21: [String: CGRect] = [
        "mediaBookStackFlags": CGRect(x: 0, y: 0, width: 768, height: 512),
        "mediaGlassesCase": CGRect(x: 768, y: 0, width: 768, height: 512),
        "mediaTeaRing": CGRect(x: 0, y: 512, width: 768, height: 512),
        "mediaPopcornTower": CGRect(x: 768, y: 512, width: 768, height: 512),
    ]

    static let integratedScenesV25: [String: CGRect] = [
        "craftBrushJarPhoto": CGRect(x: 0, y: 0, width: 768, height: 512),
        "craftCameraPuzzle": CGRect(x: 768, y: 0, width: 768, height: 512),
        "craftMissingPiece": CGRect(x: 0, y: 512, width: 768, height: 512),
        "craftCameraStand": CGRect(x: 768, y: 512, width: 768, height: 512),
    ]
    static let integratedScenesV26: [String: CGRect] = [
        "booksBedsideStack": CGRect(x: 0, y: 0, width: 768, height: 512),
        "booksBookmarkCoaster": CGRect(x: 768, y: 0, width: 768, height: 512),
        "booksPaperHat": CGRect(x: 768, y: 512, width: 768, height: 512),
    ]

    /// Original integrated stills, not separate animated rigs.
    static let integratedScenesV27: [String: CGRect] = [
        "aquariumCornersV27": CGRect(x: 0, y: 0, width: 764, height: 508),
        "birdWingsV27": CGRect(x: 772, y: 0, width: 764, height: 508),
        "aquariumExploreV27": CGRect(x: 0, y: 516, width: 764, height: 508),
        "catRestV27": CGRect(x: 772, y: 516, width: 764, height: 508),
    ]
    /// Original integrated stills, not separate animated rigs.
    static let integratedScenesV28: [String: CGRect] = [
        "sunhatShopV28": CGRect(x: 0, y: 0, width: 768, height: 512),
        "framedMapV28": CGRect(x: 768, y: 0, width: 768, height: 512),
        "departuresV28": CGRect(x: 0, y: 512, width: 768, height: 512),
        "benchMapV28": CGRect(x: 768, y: 512, width: 768, height: 512),
    ]
    /// Original integrated stills, not separate animated rigs.
    static let integratedScenesV29: [String: CGRect] = [
        "pawprintsV29": CGRect(x: 0, y: 0, width: 764, height: 508),
        "dragonRideV29": CGRect(x: 772, y: 0, width: 764, height: 508),
        "magicCupboardV29": CGRect(x: 0, y: 516, width: 764, height: 508),
        "potionLabelV29": CGRect(x: 772, y: 516, width: 764, height: 508),
    ]
    /// Original integrated stills, not separate animated rigs.
    static let integratedScenesV30: [String: CGRect] = [
        "shyCatV30": CGRect(x: 0, y: 0, width: 764, height: 508),
        "muddyDogAlbumV30": CGRect(x: 772, y: 0, width: 764, height: 508),
        "birdPerchV30": CGRect(x: 0, y: 516, width: 764, height: 508),
        "birdTiltV30": CGRect(x: 772, y: 516, width: 764, height: 508),
    ]
    /// Original integrated stills, not separate animated rigs.
    static let integratedScenesV31: [String: CGRect] = [
        "dryPavementV31": CGRect(x: 0, y: 0, width: 768, height: 512),
        "scarfSeatV31": CGRect(x: 768, y: 0, width: 768, height: 512),
        "shoeForecastV31": CGRect(x: 0, y: 512, width: 768, height: 512),
        "eveningFriendsV31": CGRect(x: 768, y: 512, width: 768, height: 512),
    ]

    /// Original integrated stills, not separate animated rigs.
    static let integratedScenesV32: [String: CGRect] = [
        "funnySignV32": CGRect(x: 0, y: 0, width: 763, height: 507),
        "patchedCaseV32": CGRect(x: 774, y: 0, width: 762, height: 507),
        "tentInteriorV32": CGRect(x: 0, y: 518, width: 763, height: 506),
        "treeShadeV32": CGRect(x: 774, y: 518, width: 762, height: 506),
    ]

    /// Original integrated stills, not separate animated rigs.
    static let integratedScenesV33: [String: CGRect] = [
        "catThanksV33": CGRect(x: 0, y: 0, width: 758, height: 502),
        "scarfSeatV33": CGRect(x: 778, y: 0, width: 758, height: 502),
        "spaceLabelsV33": CGRect(x: 0, y: 520, width: 758, height: 504),
        "sharedSimpleGadgetV33": CGRect(x: 778, y: 520, width: 758, height: 504),
    ]

    /// Original integrated stills, not separate animated rigs.
    static let integratedScenesV36: [String: CGRect] = [
        "simpleControlV36": CGRect(x: 780, y: 0, width: 756, height: 502),
        "mutedGadgetV36": CGRect(x: 0, y: 521, width: 756, height: 503),
        "robotSketchV36": CGRect(x: 780, y: 521, width: 756, height: 503),
    ]

    static let layerV34: [String: CGRect] = [
        "socialWetTile": CGRect(x: 0, y: 0, width: 780, height: 506),
        "socialInventionSketch": CGRect(x: 780, y: 0, width: 756, height: 516),
        "socialHatPattern": CGRect(x: 0, y: 506, width: 780, height: 518),
        "socialSignedFigurine": CGRect(x: 780, y: 516, width: 756, height: 508),
    ]

    static let integratedScenesV35: [String: CGRect] = [
        "hiddenTapeEndV35": CGRect(x: 0, y: 180, width: 883, height: 600),
    ]

    static let integratedScenesV37: [String: CGRect] = [
        "handmadeBuntingV37": CGRect(x: 775, y: 0, width: 761, height: 512),
        "fallenBuntingV37": CGRect(x: 775, y: 512, width: 761, height: 512),
    ]

    static let integratedScenesV43: [String: CGRect] = [
        "tinyTrimmedProjectV43": CGRect(x: 0, y: 0, width: 1536, height: 1024),
    ]

    static let integratedScenesV47: [String: CGRect] = [
        "diceTrickScoreV47": CGRect(x: 0, y: 0, width: 1536, height: 1024),
    ]

    /// Original complete illustrations; not articulated animation layers.
    static let integratedScenesV38: [String: CGRect] = [
        "hobbyClayMarkedPieces": CGRect(x: 0, y: 0, width: 768, height: 512),
        "hobbyPieceInBag": CGRect(x: 768, y: 0, width: 768, height: 512),
        "hobbyPaintStainedYarn": CGRect(x: 0, y: 512, width: 768, height: 512),
        "hobbySortedBaskets": CGRect(x: 768, y: 512, width: 768, height: 512),
    ]

    /// Original complete illustrations; not articulated animation layers.
    static let integratedScenesV39: [String: CGRect] = [
        "movieProjectorCables": CGRect(x: 0, y: 0, width: 768, height: 512),
        "movieSleepingFriend": CGRect(x: 768, y: 0, width: 768, height: 512),
        "movieClapperTray": CGRect(x: 0, y: 512, width: 768, height: 512),
        "movieProjectorRemote": CGRect(x: 768, y: 512, width: 768, height: 512),
    ]

    /// Original complete illustrations; not articulated animation layers.
    static let integratedScenesV40: [String: CGRect] = [
        "mediaLargePrintNovel": CGRect(x: 0, y: 0, width: 768, height: 512),
        "mediaTuckedBookmark": CGRect(x: 768, y: 0, width: 768, height: 512),
        "mediaBacklitSteam": CGRect(x: 0, y: 512, width: 768, height: 512),
        "mediaHangingHeadphones": CGRect(x: 768, y: 512, width: 768, height: 512),
    ]

    /// Original complete illustrations; not articulated animation layers.
    static let integratedScenesV41: [String: CGRect] = [
        "movieTicketStubClapper": CGRect(x: 0, y: 0, width: 768, height: 512),
        "movieBlanketPremiere": CGRect(x: 768, y: 0, width: 768, height: 512),
        "movieEmptyReelTin": CGRect(x: 0, y: 512, width: 768, height: 512),
        "movieReelBoxSofa": CGRect(x: 768, y: 512, width: 768, height: 512),
    ]

    /// Original complete illustrations; not articulated animation layers.
    static let integratedScenesV44: [String: CGRect] = [
        "hobbyClayFingerprints": CGRect(x: 0, y: 0, width: 768, height: 512),
        "hobbyHolidaySketch": CGRect(x: 768, y: 0, width: 768, height: 512),
        "hobbyBrushPuzzleBox": CGRect(x: 0, y: 512, width: 768, height: 512),
        "hobbyYarnBookmark": CGRect(x: 768, y: 512, width: 768, height: 512),
    ]

    /// Original complete illustrations; not articulated animation layers.
    static let integratedScenesV45: [String: CGRect] = [
        "hobbyPuzzleClayTower": CGRect(x: 0, y: 0, width: 768, height: 512),
        "hobbyClayBookReplica": CGRect(x: 768, y: 0, width: 768, height: 512),
        "hobbyBlurryPhotoPuzzle": CGRect(x: 0, y: 512, width: 768, height: 512),
        "hobbyKnotClayImprint": CGRect(x: 768, y: 512, width: 768, height: 512),
    ]

    /// Original complete illustrations; not articulated animation layers.
    static let integratedScenesV48: [String: CGRect] = [
        "booksGlassesCaseCanonical": CGRect(x: 768, y: 0, width: 768, height: 512),
    ]

    /// Original complete stills with source-drawn physical contacts.
    static let integratedScenesV46: [String: CGRect] = [
        "sunhatTripV46": CGRect(x: 0, y: 0, width: 758, height: 502),
        "robotCarriesCaseV46": CGRect(x: 778, y: 0, width: 758, height: 502),
        "vehicleAboardV46": CGRect(x: 0, y: 520, width: 758, height: 504),
        "bootsWornV46": CGRect(x: 778, y: 520, width: 758, height: 504),
    ]

    static let integratedScenesV42: [String: CGRect] = [
        "bookFlagV42": CGRect(x: 0, y: 130, width: 1536, height: 894),
        "bookScrapV42": CGRect(x: 0, y: 0, width: 1536, height: 1024),
    ]

}
