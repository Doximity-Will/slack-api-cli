import React from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

type TerminalLine = {
  text: string;
  start: number;
  className?: string;
};

const terminalLines: TerminalLine[] = [
  {text: '$ npm install -g slack-api-cli', start: 18, className: 'command'},
  {text: '+ slack-api-cli@0.1.0', start: 78, className: 'success'},
  {text: '$ slack-api setup', start: 112, className: 'command'},
  {text: 'Slack workspace URL: https://example.slack.com', start: 154},
  {text: 'Opening Slack in a browser profile...', start: 206},
  {text: 'Complete sign-in if prompted.', start: 242},
  {text: 'Authenticated as: alex', start: 314, className: 'success'},
  {text: 'Try: slack-api me', start: 346, className: 'muted'},
];

const featureLines: TerminalLine[] = [
  {text: '$ slack-api search --query release --since 5m', start: 386, className: 'command'},
  {text: '{ "resultCount": 3, "text": "[redacted]" }', start: 442, className: 'json'},
  {text: '$ slack-api read --link https://example.slack.com/archives/C0123456789/p...', start: 500, className: 'command'},
  {text: '{ "threadCount": 6, "includeText": false }', start: 556, className: 'json'},
  {text: '$ slack-api reply --link ... --message "Thanks" --send', start: 614, className: 'command'},
  {text: '{ "ok": true, "mode": "sent" }', start: 670, className: 'success'},
  {text: '$ slack-api react --link ... --emoji eyes --add', start: 724, className: 'command'},
  {text: '{ "ok": true, "mode": "added", "emoji": ":eyes:" }', start: 780, className: 'success'},
];

const cardData = [
  {
    title: 'Private by default',
    body: 'Message text is redacted unless you opt in with include flags.',
    start: 390,
  },
  {
    title: 'Dry-run safe',
    body: 'Send, reply, react, and draft commands require explicit mutation flags.',
    start: 535,
  },
  {
    title: 'Local session',
    body: 'No Slack app required. Reuses the browser session you sign into locally.',
    start: 680,
  },
];

const typeText = (text: string, frame: number, start: number, charsPerFrame = 1.2) => {
  const count = Math.max(0, Math.floor((frame - start) * charsPerFrame));
  return text.slice(0, count);
};

const useSceneOpacity = (start: number, end: number) => {
  const frame = useCurrentFrame();
  return interpolate(frame, [start, start + 18, end - 18, end], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
};

const Terminal = ({lines, compact = false}: {lines: TerminalLine[]; compact?: boolean}) => {
  const frame = useCurrentFrame();

  return (
    <div className={compact ? 'terminal compact' : 'terminal'}>
      <div className="terminalChrome">
        <span />
        <span />
        <span />
        <p>slack-api</p>
      </div>
      <div className="terminalBody">
        {lines.map((line) => {
          const visible = frame >= line.start;
          return (
            <div className={`terminalLine ${line.className ?? ''}`} key={`${line.start}-${line.text}`}>
              {visible ? typeText(line.text, frame, line.start) : ''}
              {frame >= line.start && frame < line.start + line.text.length / 1.2 + 18 ? (
                <span className="cursor" />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const BrowserMock = () => {
  const frame = useCurrentFrame();
  const signedIn = frame > 285;
  const progress = interpolate(frame, [190, 310], [12, 100], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div className="browser">
      <div className="browserBar">
        <div className="browserDots">
          <span />
          <span />
          <span />
        </div>
        <div className="address">https://example.slack.com/client</div>
      </div>
      <div className="browserContent">
        <div className="slackLogo">#</div>
        <h2>{signedIn ? 'Session cached' : 'Sign in to Slack'}</h2>
        <p>{signedIn ? 'Ready for terminal workflows' : 'Complete browser sign-in once'}</p>
        <div className="progressTrack">
          <div className="progressFill" style={{width: `${progress}%`}} />
        </div>
        <div className="browserStatus">
          <span className={signedIn ? 'statusDot on' : 'statusDot'} />
          {signedIn ? 'auth.test ok' : 'waiting for signed-in browser session'}
        </div>
      </div>
    </div>
  );
};

const FeatureCard = ({title, body, start}: {title: string; body: string; start: number}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const scale = spring({
    frame: frame - start,
    fps,
    config: {
      damping: 18,
      stiffness: 120,
      mass: 0.8,
    },
  });
  const opacity = interpolate(frame, [start - 15, start + 10], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div
      className="featureCard"
      style={{
        opacity,
        transform: `translateY(${(1 - scale) * 28}px) scale(${0.96 + scale * 0.04})`,
      }}
    >
      <div className="cardRule" />
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
};

const SetupScene = () => {
  const opacity = useSceneOpacity(0, 382);
  const frame = useCurrentFrame();
  const titleY = interpolate(frame, [0, 55], [24, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill className="scene" style={{opacity}}>
      <div className="heroHeader" style={{transform: `translateY(${titleY}px)`}}>
        <p className="eyebrow">slack-api-cli</p>
        <h1>Set up once. Work from the terminal.</h1>
      </div>
      <div className="setupGrid">
        <Terminal lines={terminalLines} />
        <BrowserMock />
      </div>
    </AbsoluteFill>
  );
};

const FeatureScene = () => {
  const opacity = useSceneOpacity(350, 820);

  return (
    <AbsoluteFill className="scene featureScene" style={{opacity}}>
      <div className="featureHeader">
        <p className="eyebrow">Browser session powered Slack workflows</p>
        <h2>Search, read, reply, react, upload, and draft.</h2>
      </div>
      <div className="featureGrid">
        <Terminal lines={featureLines} compact />
        <div className="cards">
          {cardData.map((card) => (
            <FeatureCard key={card.title} {...card} />
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const ClosingScene = () => {
  const opacity = useSceneOpacity(790, 900);
  const frame = useCurrentFrame();
  const glow = interpolate(frame, [790, 860], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill className="closing" style={{opacity}}>
      <div className="closingPanel">
        <p className="eyebrow">Install</p>
        <h2>npm install -g slack-api-cli</h2>
        <p>github.com/ronnie3786/slack-api-cli</p>
        <div className="installBar">
          <div style={{width: `${glow * 100}%`}} />
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const SlackApiCliDemo = () => {
  return (
    <AbsoluteFill className="video">
      <div className="backgroundGrid" />
      <div className="accent accentA" />
      <div className="accent accentB" />
      <SetupScene />
      <FeatureScene />
      <ClosingScene />
    </AbsoluteFill>
  );
};
