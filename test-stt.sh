#!/bin/bash

# Test script for STT endpoint

echo "Testing STT endpoint..."

# Create a simple test WAV file using GStreamer
echo "Creating test audio file..."
gst-launch-1.0 -e audiotestsrc freq=440 duration=1 ! audioconvert ! audioresample ! audio/x-raw,rate=16000,channels=1 ! wavenc ! filesink location=test-audio.wav

# Send to STT endpoint
echo "Sending to STT endpoint..."
curl -X POST "http://localhost:8675/transcribe" \
     -H "accept: application/json" \
     -H "Content-Type: multipart/form-data" \
     -F "file=@test-audio.wav"

# Clean up
rm -f test-audio.wav

echo "Test complete!"