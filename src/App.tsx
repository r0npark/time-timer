import React, { useCallback, useEffect, useRef, useState } from 'react'
import useLocalStorage from 'use-local-storage'

import './App.scss'
import doneSoundUri from './assets/done.wav'
import tickSoundUri from './assets/tick.wav'
import useSound from './hooks/useSound'
import useTheme from './hooks/useTheme'
import useTouch, { TouchHandler } from './hooks/useTouch'
import { AnimationUtils, EaseFuncs } from './utils/animation'
import { EnvironmentUtils } from './utils/env'
import { ExtensionUtils } from './utils/extension'
import { PointUtils } from './utils/point'

const MIN_LEFT_SECONDS = 60 * 1
const MAX_LEFT_SECONDS = 60 * 60
const DEFAULT_LEFT_SECONDS = 10 * 60

const getLeftSecondsFromNow = (date: Date) => (date.getTime() - new Date().getTime()) / 1000

const getSecondsNearestMinute = (seconds: number) => Math.round(seconds / 60) * 60

const getDegreeFromClientCenter = (clientX: number, clientY: number) => {
  const { clientWidth, clientHeight } = document.documentElement
  return PointUtils.getDegree(clientX - clientWidth / 2, clientY - clientHeight / 2)
}

const getDistanceFromClientCenter = (clientX: number, clientY: number) => {
  const { clientWidth, clientHeight } = document.documentElement
  return PointUtils.getDistance(clientX - clientWidth / 2, clientY - clientHeight / 2)
}

const App = () => {
  const [lastSeconds, setLastSeconds] = useLocalStorage('last', DEFAULT_LEFT_SECONDS)
  const [seconds, setLeftSeconds] = useState<number>(lastSeconds)
  const [endDate, setEndDate] = useState<Date | null>(null)

  const [enabled, setEnabled] = useState<boolean>(false)
  const [editing, setEditing] = useState<boolean>(false)
  const finished = enabled && seconds <= 0

  const editingLeftSecondsRef = useRef<number>(0)
  const editingChangedRef = useRef<boolean>(false)
  const [isSoundOn, setSoundOn] = useLocalStorage('sound', false)
  const { play: playSound, handleAfterUserInteraction } = useSound(isSoundOn)

  const { toggleTheme } = useTheme()

  const prevAnimation = useRef<{ cancel(): void } | null>(null)
  const clockProcessLeftRef = useRef<HTMLDivElement>(null)
  const clockProcessRightRef = useRef<HTMLDivElement>(null)

  const renderLeftSeconds = useCallback((seconds: number) => {
    const progress = Math.max(0, Math.min(3600, seconds)) / 3600

    const leftDeg = `${Math.max(0, 0.5 - progress) * 360}deg`
    const rightDeg = `${Math.min(0.5, 1 - progress) * 360}deg`

    const leftStyle = clockProcessLeftRef.current?.style
    const rightStyle = clockProcessRightRef.current?.style

    if (leftStyle?.getPropertyValue('--degree') !== leftDeg) {
      leftStyle?.setProperty('--degree', leftDeg)
    }
    if (rightStyle?.getPropertyPriority('--degree') !== rightDeg) {
      rightStyle?.setProperty('--degree', rightDeg)
    }
  }, [])

  // Update leftSeconds and badge
  useEffect(() => {
    renderLeftSeconds(seconds)

    if (!enabled) {
      ExtensionUtils.setBadgeText('')
    } else if (seconds > 0) {
      ExtensionUtils.setBadgeText(`${Math.ceil(seconds / 60)}m`)
      ExtensionUtils.setBadgeColor('#00C853')
    } else {
      ExtensionUtils.setBadgeText('🏁')
      ExtensionUtils.setBadgeColor('#FF5A5F')
    }
  }, [seconds, enabled, renderLeftSeconds])

  // Tick per seconds
  useEffect(() => {
    if (enabled && endDate && !editing) {
      const update = () => {
        const leftSeconds = Math.max(0, getLeftSecondsFromNow(endDate))

        const isFinished = leftSeconds <= 0

        if (isFinished) {
          setLeftSeconds(0)
          return
        }

        setLeftSeconds(leftSeconds)
      }

      update()

      const t = setInterval(update, 1000)
      return () => clearInterval(t)
    } else {
      setLeftSeconds(lastSeconds)
    }
  }, [enabled, editing, endDate, lastSeconds])

  // Play finished sound
  useEffect(() => {
    if (finished) {
      playSound(doneSoundUri)

      const t = setInterval(() => {
        playSound(doneSoundUri)
      }, 15000)

      return () => clearInterval(t)
    }
  }, [finished, playSound])

  const touchHandler: TouchHandler = useCallback(
    async ({ clientX, clientY, type, prev }) => {
      if (handleAfterUserInteraction) {
        return
      }

      switch (type) {
        case 'down': {
          const { clientWidth, clientHeight } = document.documentElement

          if (getDistanceFromClientCenter(clientX, clientY) < Math.min(clientWidth, clientHeight) * 0.4) {
            editingLeftSecondsRef.current = endDate
              ? getLeftSecondsFromNow(endDate)
              : getSecondsNearestMinute(lastSeconds)

            setEndDate(null)
            setEditing(true)
            editingChangedRef.current = false
          }
          break
        }
        case 'move': {
          if (editing) {
            const deg = getDegreeFromClientCenter(clientX, clientY)
            const prevDeg = getDegreeFromClientCenter(prev.clientX, prev.clientY)
            let diffDig = deg - prevDeg
            if (diffDig > 180) {
              diffDig -= 360
            } else if (diffDig < -180) {
              diffDig += 360
            }

            const nextLeftSeconds = Math.max(
              MIN_LEFT_SECONDS,
              Math.min(MAX_LEFT_SECONDS, Math.floor(editingLeftSecondsRef.current - (diffDig / 360) * 3600)),
            )

            editingLeftSecondsRef.current = nextLeftSeconds

            const leftSecondsNearestMinute = getSecondsNearestMinute(nextLeftSeconds)

            if (lastSeconds !== leftSecondsNearestMinute) {
              editingChangedRef.current = true
              setEnabled(false)
              setLastSeconds(leftSecondsNearestMinute)
              prevAnimation.current?.cancel()

              const animation = (prevAnimation.current = AnimationUtils.animate(
                lastSeconds,
                leftSecondsNearestMinute,
                100,
                EaseFuncs.easeInQuad,
                renderLeftSeconds,
              ))

              playSound(tickSoundUri)
              await animation.promise
            }
          }
          break
        }
        case 'up': {
          if (editing) {
            const endDate = new Date(new Date().getTime() + lastSeconds * 1000)
            setEndDate(endDate)
            setEditing(false)

            if (!editingChangedRef.current) {
              if (finished) {
                setEnabled(false)
                prevAnimation.current?.cancel()
                const animation = (prevAnimation.current = AnimationUtils.animate(
                  0,
                  lastSeconds,
                  500,
                  EaseFuncs.easeInQuad,
                  renderLeftSeconds,
                ))
                await animation.promise
              } else {
                setEnabled((prev) => !prev)
              }
            } else {
              setEnabled(true)
            }
          }
          break
        }
      }
    },
    [finished, editing, endDate, lastSeconds, handleAfterUserInteraction, playSound, setLastSeconds, renderLeftSeconds],
  )

  useTouch({ handler: touchHandler, forceUseMouse: EnvironmentUtils.getBuildTarget() === 'extension' })

  return (
    <div className={`app ${finished ? 'finished' : ''}`}>
      <div className="clock__container">
        <div className="clock__axis" />
        <div className="clock__indicator__wrapper">
          {Array.from({ length: 60 }).map((_, offset) => (
            <section key={offset} className="clock__indicator" />
          ))}
        </div>
        <div className="clock__label__wrapper">
          {Array.from({ length: 12 }).map((_, offset) => (
            <section key={offset} className="clock__label">
              {offset * 5}
            </section>
          ))}
        </div>
        <div
          className="clock__progress__wrapper"
          style={{
            transform: enabled && !editing ? 'scale(1)' : 'scale(0.93)',
            visibility: finished ? 'hidden' : 'inherit',
          }}>
          <div className={`clock__progress__left`} ref={clockProcessLeftRef} />
          <div className={`clock__progress__right`} ref={clockProcessRightRef} />
        </div>
      </div>
      <div className="button__group">
        <button
          className={`button__sound ${isSoundOn ? 'on' : 'off'}`}
          onClick={() => {
            setSoundOn((prev) => !prev)
          }}
        />
        <button className="button__theme" onClick={toggleTheme} />
      </div>
      {handleAfterUserInteraction && (
        <div className="guide-user-interaction" onClick={() => handleAfterUserInteraction()}>
          Click to play
        </div>
      )}
    </div>
  )
}

export default App
