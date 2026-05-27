import {Composition} from 'remotion';
import {SlackApiCliDemo} from './SlackApiCliDemo';
import './styles.css';

export const Root = () => {
  return (
    <Composition
      id="SlackApiCliDemo"
      component={SlackApiCliDemo}
      durationInFrames={900}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
