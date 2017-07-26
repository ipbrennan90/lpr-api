const openalpr = require('node-openalpr')
const fileUpload = require('express-fileupload')
const express = require('express')
const app = express()
const tmp = require('tmp')
const fs = require('fs')
const AdmZip = require('adm-zip')
const mysql = require('mysql')
const connection = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'portland',
  database: 'license_plate'
})

function identifyWithConfidence(confidenceLevel, path, count, cb) {
  const max = 30
  identify(path).then(result => {
    if (result.confidence >= confidenceLevel) {
      cb(result.plate)
    } else if (count === max) {
      cb(false)
    } else {
      count += 1
      identifyWithConfidence(confidenceLevel, path, count, cb)
    }
  })
}

function identify(path) {
  return new Promise((resolve, reject) => {
    openalpr.Start()
    openalpr.IdentifyLicense(path, function(error, output) {
      if (error) reject(error)
      const results = output.results
      let result = { plate: 'none', confidence: 0 }
      if (results.length > 0) {
        result.plate = results[0].plate
        result.confidence = results[0].confidence
      }
      resolve(result)
    })
  })
}

function newFile(licensePlate, path) {
  return new Promise(function(resolve, reject) {
    licensePlate.mv(path, function(err) {
      if (err) {
        reject(err)
      } else {
        resolve(path)
      }
    })
  })
}

function identifyPlatesFromBuffer(data, index) {
  return new Promise((resolve, reject) => {
    const tmpDir = tmp.dirSync()
    const fileContents = data.toString('base64')
    const bitmap = new Buffer(fileContents, 'base64')
    const tmpPath = `${tmpDir.name}/copy_${index}.jpg`
    const tmpFile = fs.writeFileSync(tmpPath, data)
    let result = identifyWithConfidence(90, tmpPath, 0, result => {
      if (result) {
        connection.query(
          `INSERT INTO Vehicle (LicensePlate) VALUES ('${result}')`,
          (err, result) => {
            if (err) reject(err)
            console.log(result)
            resolve(result)
          }
        )
        connection.release()
      } else resolve('No plates found for photo')
    })
  })
}

// recursive function, calls promise, waits for promise response, calls promise again

function identifyArrayOfPhotos(PhotoArray, count, cb) {
  let total = PhotoArray.length
  identifyPlatesFromBuffer(PhotoArray[count], count)
    .then(result => {
      console.log(count, result)
      count += 1
      if (count < total) {
        identifyArrayOfPhotos(PhotoArray, count, cb)
      } else {
        cb('success')
      }
    })
    .catch(err => console.log(err))
}

app.use(fileUpload())

app.post('/upload-zip', function(req, res) {
  if (req.files) {
    const tmpDir = tmp.dirSync()
    const licensePlates = req.files.license_plates
    console.log(licensePlates)
    newFile(licensePlates, `${tmpDir.name}/license_plates.zip`).then(function(
      path
    ) {
      const zip = new AdmZip(path)
      zip.extractAllTo(tmpDir.name)
      fs.readdir(`${tmpDir.name}`, (err, files) => {
        if (err) {
          console.log(err)
        } else {
          let bufferArray = files.map((file, index) => {
            return fs.readFileSync(`${tmpDir.name}/${file}`)
          })
          identifyArrayOfPhotos(bufferArray, 0, message => {
            res.send(message)
          })
        }
      })
    })
  }
})

app.listen(3000, function() {
  console.log('Example app listening on port 3000!')
})
