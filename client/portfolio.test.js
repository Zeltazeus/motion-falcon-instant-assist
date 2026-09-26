import assert from "node:assert/strict";
import test from "node:test";

import {
  getYouTubeVideoId,
  normalizePortfolioManifest,
  normalizePortfolioSection,
} from "./portfolio.js";

test("portfolio section aliases default to Current Work", () => {
  assert.equal(normalizePortfolioSection("Recent Work"), "current-work");
  assert.equal(normalizePortfolioSection("gallery"), "images");
  assert.equal(normalizePortfolioSection("photo"), "images");
  assert.equal(normalizePortfolioSection("short videos"), "videos");
  assert.equal(normalizePortfolioSection(undefined), "current-work");
});

test("YouTube watch and short URLs resolve only supported video IDs", () => {
  assert.equal(getYouTubeVideoId("https://www.youtube.com/watch?v=abcdefghijk"), "abcdefghijk");
  assert.equal(getYouTubeVideoId("https://youtube.com/shorts/abcdefghijk"), "abcdefghijk");
  assert.equal(getYouTubeVideoId("https://youtu.be/abcdefghijk"), "abcdefghijk");
  assert.equal(getYouTubeVideoId("https://youtube.com.evil.test/watch?v=abcdefghijk"), null);
  assert.equal(getYouTubeVideoId("javascript:alert(1)"), null);
  assert.equal(getYouTubeVideoId("https://youtube.com/embed/abcdefghijk"), null);
});

test("video titles and descriptions are optional", () => {
  const manifest = normalizePortfolioManifest({
    currentWork: [],
    images: [],
    videos: [
      { url: "https://youtu.be/tAh_9HI1Awg" },
      { url: "https://youtu.be/hHmrz4x9fZA", title: "Custom title" },
    ],
  });

  assert.deepEqual(manifest.videos, [
    { videoId: "tAh_9HI1Awg", title: "Video 1", description: "" },
    { videoId: "hHmrz4x9fZA", title: "Custom title", description: "" },
  ]);
});

test("empty manifest is valid and image paths stay in the public portfolio directory", () => {
  assert.deepEqual(normalizePortfolioManifest({ currentWork: [], images: [], videos: [] }), {
    currentWork: [],
    images: [],
    videos: [],
  });
  assert.throws(() => normalizePortfolioManifest({ currentWork: [], images: [], videos: [{
    title: "Video",
    url: "https://example.com/video",
  }] }), /valid YouTube/);
  assert.throws(() => normalizePortfolioManifest({
    currentWork: [{ src: "/portfolio/images/image.jpg", title: "Image", alt: "Image" }],
    images: [],
    videos: [],
  }), /inside \/portfolio\/current-work\//);
});

test("current work and gallery images use their own folders and accept encoded spaces", () => {
  const manifest = normalizePortfolioManifest({
    currentWork: [{
      src: "/portfolio/current-work/recent%20project.webp",
      title: "Recent project",
      alt: "Project installation",
    }],
    images: [{
      src: "/portfolio/images/gallery%20detail.webp",
      title: "Gallery image",
      alt: "Close-up project detail",
    }],
    videos: [],
  });

  assert.equal(manifest.currentWork[0].src, "/portfolio/current-work/recent%20project.webp");
  assert.equal(manifest.images[0].src, "/portfolio/images/gallery%20detail.webp");
  assert.throws(() => normalizePortfolioManifest({
    currentWork: [{
      src: "/portfolio/current-work/%2e%2e/private.webp",
      title: "Project",
      alt: "Project image",
    }],
    images: [],
    videos: [],
  }), /inside \/portfolio\/current-work\//);
  assert.throws(() => normalizePortfolioManifest({
    currentWork: [{
      src: "/portfolio/images/project.webp",
      title: "Project",
      alt: "Project image",
    }],
    images: [],
    videos: [],
  }), /inside \/portfolio\/current-work\//);
});