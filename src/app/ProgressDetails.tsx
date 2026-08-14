import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import type { DailyStat, VocabCard } from "../domain/models";
import {
  buildMonthCalendar,
  buildVocabularyHistory,
  canMoveToNextMonth,
  formatVocabularyGraphDate,
  localEpochDay,
  niceVocabularyAxisMax,
  studyDaySet,
  vocabularyChartXIndexes
} from "../domain/stats";

export function StudyCalendarBottomSheet(props: { stats: DailyStat[]; onDismiss: () => void }) {
  const today = new Date();
  const todayEpochDay = localEpochDay(today);
  const studyDays = useMemo(() => studyDaySet(props.stats), [props.stats]);
  const [month, setMonth] = useState({ year: today.getFullYear(), monthIndex: today.getMonth() });
  const cells = useMemo(() => buildMonthCalendar(month.year, month.monthIndex), [month]);
  const canNext = canMoveToNextMonth(month.year, month.monthIndex, today);

  function moveMonth(delta: number) {
    setMonth((current) => {
      const date = new Date(current.year, current.monthIndex + delta, 1);
      return { year: date.getFullYear(), monthIndex: date.getMonth() };
    });
  }

  return <BottomSheet title="✦ 学習カレンダー" onDismiss={props.onDismiss}>
    <div className="calendar-header">
      <button className="icon-button ghost" aria-label="前月へ" onClick={() => moveMonth(-1)}><ChevronLeft size={18} /></button>
      <strong>{month.year}年{month.monthIndex + 1}月</strong>
      <button className="icon-button ghost" aria-label="次月へ" disabled={!canNext} onClick={() => moveMonth(1)}><ChevronRight size={18} /></button>
    </div>
    <div className="study-calendar" role="grid" aria-label={`${month.year}年${month.monthIndex + 1}月の学習カレンダー`}>
      {["日", "月", "火", "水", "木", "金", "土"].map((weekday) => <span className="calendar-weekday" key={weekday}>{weekday}</span>)}
      {cells.map((cell, index) => {
        const studied = cell.epochDay !== null && studyDays.has(cell.epochDay);
        const todayClass = cell.epochDay === todayEpochDay ? " today" : "";
        return <span className={`calendar-day${todayClass}`} key={`${cell.day ?? "blank"}-${index}`}>
          {cell.day !== null && <>
            <span>{cell.day}</span>
            {studied && <i aria-label="学習した日">✦</i>}
          </>}
        </span>;
      })}
    </div>
    <p className="small calendar-legend">✦ 学習した日</p>
  </BottomSheet>;
}

export function VocabularyHistoryBottomSheet(props: { vocab: VocabCard[]; onDismiss: () => void }) {
  const history = useMemo(() => buildVocabularyHistory(props.vocab), [props.vocab]);
  return <BottomSheet title="✦ ボキャブラリーの推移" onDismiss={props.onDismiss}>
    <p className="muted">現在 {props.vocab.length} 語</p>
    {history.length === 0
      ? <div className="empty-chart">ボキャブラリーを追加すると<br />ここに推移が表示されます</div>
      : <div className="vocab-chart-card"><VocabularyLineChart points={history} /></div>}
  </BottomSheet>;
}

function BottomSheet(props: { title: string; onDismiss: () => void; children: ReactNode }) {
  const { onDismiss } = props;
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDismiss]);

  return <div className="bottom-sheet-backdrop" role="presentation" onClick={props.onDismiss}>
    <section className="bottom-sheet" role="dialog" aria-modal="true" aria-label={props.title} onClick={(event) => event.stopPropagation()}>
      <div className="bottom-sheet-handle" aria-hidden="true" />
      <div className="bottom-sheet-title">
        <h2>{props.title}</h2>
        <button className="icon-button ghost" aria-label="閉じる" onClick={props.onDismiss}><X size={18} /></button>
      </div>
      {props.children}
    </section>
  </div>;
}

function VocabularyLineChart(props: { points: Array<{ epochDay: number; count: number }> }) {
  const points = props.points;
  const maxCount = Math.max(...points.map((point) => point.count));
  const yMax = niceVocabularyAxisMax(maxCount);
  const yLabels = [yMax, yMax * 3 / 4, yMax / 2, yMax / 4, 0].map(Math.round);
  const xIndexes = vocabularyChartXIndexes(points.length);
  const firstDay = points[0].epochDay;
  const lastDay = points[points.length - 1].epochDay;
  const left = 36;
  const right = 12;
  const top = 12;
  const bottom = 32;
  const width = 360;
  const height = 220;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;

  function xAt(index: number) {
    if (points.length === 1) return left + chartWidth / 2;
    return left + chartWidth * index / (points.length - 1);
  }

  function yAt(value: number) {
    return top + chartHeight * (1 - value / yMax);
  }

  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${xAt(index).toFixed(2)} ${yAt(point.count).toFixed(2)}`).join(" ");
  const latestX = xAt(points.length - 1);
  const latestY = yAt(points[points.length - 1].count);

  return <svg className="vocab-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="ボキャブラリー数の推移グラフ">
    {yLabels.map((label, index) => {
      const y = top + chartHeight * index / 4;
      return <g key={`${label}-${index}`}>
        <line x1={left} y1={y} x2={width - right} y2={y} className="chart-grid" />
        <text x={left - 8} y={y + 4} textAnchor="end" className="chart-label">{label}</text>
      </g>;
    })}
    <path d={path} className="chart-line" />
    <circle cx={latestX} cy={latestY} r="4.5" className="chart-point" />
    {xIndexes.map((index, labelIndex) => {
      const x = xAt(index);
      const anchor = labelIndex === 0 ? "start" : labelIndex === xIndexes.length - 1 ? "end" : "middle";
      return <text key={index} x={x} y={height - 8} textAnchor={anchor} className="chart-label">{formatVocabularyGraphDate(points[index].epochDay, firstDay, lastDay)}</text>;
    })}
  </svg>;
}
