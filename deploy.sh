#!/bin/bash

# Deployment script for Unicity Runner

echo "Deploying Unicity Runner to vrogojin@154.53.58.93..."

# Ensure all assets are in dist
echo "Copying assets to dist folder..."
cp -r assets dist/

# Create the remote directory
echo "Creating remote directory..."
ssh vrogojin@154.53.58.93 "mkdir -p /home/vrogojin/unirun_html"

# Upload all files from dist/ to the remote server
echo "Uploading files..."
scp -r dist/* vrogojin@154.53.58.93:/home/vrogojin/unirun_html/

# Set proper permissions
echo "Setting permissions..."
ssh vrogojin@154.53.58.93 "chmod -R 755 /home/vrogojin/unirun_html"

echo "Deployment complete!"
echo ""
echo "Files uploaded:"
echo "- index.html"
echo "- unicity-sdk.js"
echo "- assets/ (all textures and game assets)"
echo ""
echo "Your game should now be accessible at: http://154.53.58.93/unirun_html/"