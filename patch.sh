#!/bin/bash

# MaterialListView.tsx (already has error callback, just insert before console.error)
sed -i 's/console.error("Error fetching materials: ", err);/console.error("[監聽來源:MaterialListView-materials]", err);\n            console.error("Error fetching materials: ", err);/g' src/components/MaterialListView.tsx

# MaterialDetailView.tsx (needs to add error callback)
sed -i 's/        });\n\n        \n        return () => unsubscribe();/        }, (error) => {\n            console.error("[監聽來源:MaterialDetailView-material]", error);\n        });\n\n        \n        return () => unsubscribe();/g' src/components/MaterialDetailView.tsx

# MaterialImportMode.tsx (needs to add error callback to both)
sed -i 's/                    }\n                });/                    }\n                }, (error) => {\n                    console.error("[監聽來源:MaterialImportMode-profileSettings]", error);\n                });/g' src/components/MaterialImportMode.tsx

sed -i 's/                    setVocabData(items);\n                });/                    setVocabData(items);\n                }, (error) => {\n                    console.error("[監聽來源:MaterialImportMode-flashcards]", error);\n                });/g' src/components/MaterialImportMode.tsx

# LanguageModelListView.tsx (already has error callback)
sed -i 's/console.error("Error fetching language patterns: ", err);/console.error("[監聽來源:LanguageModelListView-languagePatterns]", err);\n            console.error("Error fetching language patterns: ", err);/g' src/components/LanguageModelListView.tsx

# LanguageModelDetailView.tsx (needs to add error callback)
sed -i 's/            }\n        });\n\n        return () => unsubscribe();/            }\n        }, (error) => {\n            console.error("[監聽來源:LanguageModelDetailView-languagePattern]", error);\n        });\n\n        return () => unsubscribe();/g' src/components/LanguageModelDetailView.tsx

# BadgeMode.tsx (needs to add error callback)
sed -i 's/            setLoading(false);\n        });\n        return () => unsubscribe();/            setLoading(false);\n        }, (error) => {\n            console.error("[監聽來源:BadgeMode-languagePatterns]", error);\n        });\n        return () => unsubscribe();/g' src/components/BadgeMode.tsx

# TodayReviewView.tsx (needs to add error callback)
sed -i 's/            setLoading(false);\n        });\n        return () => unsubscribe();/            setLoading(false);\n        }, (error) => {\n            console.error("[監聽來源:TodayReviewView-languagePatterns]", error);\n        });\n        return () => unsubscribe();/g' src/components/TodayReviewView.tsx

