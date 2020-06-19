const fse = require('fs-extra')
const path = require('path')

const libDir = path.resolve(__dirname, '../client/lib')
const typeFile = path.resolve(__dirname, '../types/amqp.d.ts')

const getAllFiles = async (dir) => {
  const allFiles = []
  const walkDir = async (dir) => {
    const files = await fse.readdir(dir)
    for (const filename of files) {
      const filePath = path.join(dir, filename)
      const fileStat = await fse.lstat(filePath)
      if (fileStat.isDirectory()) {
        await walkDir(filePath)
      } else {
        allFiles.push(filePath)
      }
    }
  }
  await walkDir(dir)
  return allFiles
}

;(async () => {
  await fse.copyFile(typeFile, path.join(libDir, 'types.d.ts'))
  const allFiles = await getAllFiles(libDir)
  const declareFiles = allFiles.filter((p) => p.endsWith('d.ts'))
  await Promise.all(
    declareFiles.map(async (filepath) => {
      const relative = filepath.replace(libDir, '')
      const level = relative.split('/').length - 2
      const prefix = level > 0 ? '../'.repeat(level) : './'
      const fileBuffer = await fse.readFile(filepath)
      const content = fileBuffer
        .toString()
        .replace(/from ['|"]types\/amqp['|"];?/g, `from '${prefix}types';`)
      await fse.writeFile(filepath, content)
    })
  )
})()
