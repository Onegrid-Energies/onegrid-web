#!/bin/bash

HTML_FILE="index.html"

# Ensure the HTML file exists
if [ ! -f "$HTML_FILE" ]; then
    echo "Error: '$HTML_FILE' not found in this directory."
    exit 1
fi

EXTENSIONS=("css" "js")

for EXT in "${EXTENSIONS[@]}"; do
    echo "Checking for .$EXT files..."

    # 1. Find the current asset reference in the HTML
    CURRENT_REF=$(grep -oE "[a-zA-Z0-9_-]+\.[a-f0-9]{8,32}\.${EXT}" "$HTML_FILE" | head -n 1)

    # Fallback: check if it's currently unhashed (e.g., styles.css)
    if [ -z "$CURRENT_REF" ]; then
        CURRENT_REF=$(grep -oE "[a-zA-Z0-9_-]+\.${EXT}" "$HTML_FILE" | head -n 1)
    fi

    if [ -z "$CURRENT_REF" ]; then
        echo "  -> No .$EXT reference found in $HTML_FILE. Skipping."
        continue
    fi

    # 2. Ensure the file mentioned in the HTML actually exists on your disk
    if [ ! -f "$CURRENT_REF" ]; then
        echo "  -> ⚠️ Found '$CURRENT_REF' in HTML, but the file doesn't exist in this folder! Skipping."
        continue
    fi

    # 3. Extract the clean base name (e.g., "styles.1a666825.css" -> "styles")
    NAME=$(echo "$CURRENT_REF" | cut -d'.' -f1)

    # 4. Calculate the new MD5 hash from the EXISTING file based on OS
    if command -v md5 >/dev/null 2>&1; then
        FULL_HASH=$(md5 -q "$CURRENT_REF")
    elif command -v md5sum >/dev/null 2>&1; then
        FULL_HASH=$(md5sum "$CURRENT_REF" | awk '{print $1}')
    else
        echo "Error: Neither md5 nor md5sum found."
        exit 1
    fi

    # 5. Shorten hash to 8 characters
    SHORT_HASH=$(echo "$FULL_HASH" | cut -c 1-8)
    NEW_FILE="${NAME}.${SHORT_HASH}.${EXT}"

    # 6. Skip if the file content hasn't changed (hash is identical)
    if [ "$CURRENT_REF" == "$NEW_FILE" ]; then
        echo "  -> $CURRENT_REF hasn't changed. Skipping."
        continue
    fi

    # 7. 🔄 RENAME: Directly rename the old file to the new hashed filename
    mv "$CURRENT_REF" "$NEW_FILE"
    echo "  -> Renamed: $CURRENT_REF -> $NEW_FILE"

    # 8. Update the reference inside every static route document
    if sed --version >/dev/null 2>&1; then
        # GNU sed (Linux)
        find . -type f -name "index.html" -not -path "*/node_modules/*" -exec sed -i "s/$CURRENT_REF/$NEW_FILE/g" {} +
    else
        # BSD sed (macOS)
        find . -type f -name "index.html" -not -path "*/node_modules/*" -exec sed -i "" "s/$CURRENT_REF/$NEW_FILE/g" {} +
    fi

    echo "  -> 🎉 Successfully updated $EXT references in all route documents!"
done

echo "Done!"
