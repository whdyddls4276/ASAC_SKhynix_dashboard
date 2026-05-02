import { useState, useEffect } from 'react'
import Papa from 'papaparse'

export function useCSV(path) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(path)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.text()
      })
      .then(text => {
        const result = Papa.parse(text, { header: true, dynamicTyping: true, skipEmptyLines: true })
        setData(result.data)
      })
      .catch(err => console.error(`[useCSV] ${path}:`, err))
      .finally(() => setLoading(false))
  }, [path])

  return { data, loading }
}
