import * as xdebug from './xdebugConnection'

export async function varExportProperty(property: xdebug.Property, indent: string = ''): Promise<string> {
    if (indent.length >= 20) {
        // prevent infinite recursion
        return `...`
    }

    let displayValue: string
    if (property.hasChildren || property.type === 'array' || property.type === 'object') {
        if (!property.children || property.children.length === 0) {
            // TODO: also take into account the number of children for pagination
            property.children = await property.getChildren()
        }
        displayValue = (
            await Promise.all(
                property.children.map(async property => {
                    const indent2 = indent + '  '
                    if (property.hasChildren) {
                        return `${indent2}${property.name} => \n${indent2}${await varExportProperty(
                            property,
                            indent2
                        )},`
                    } else {
                        return `${indent2}${property.name} => ${await varExportProperty(property, indent2)},`
                    }
                })
            )
        ).join('\n')

        if (property.type === 'array') {
            // for arrays, show the length, like a var_dump would do
            displayValue = `array (\n${displayValue}\n${indent})`
        } else if (property.type === 'object' && property.class) {
            // for objects, show the class name as type (if specified)
            displayValue = `${property.class}::__set_state(array(\n${displayValue}\n${indent}))`
        } else {
            // edge case: show the type of the property as the value
            displayValue = `?${property.type}?(\n${displayValue})`
        }
    } else {
        // for null, uninitialized, resource, etc. show the type
        displayValue = property.value || property.type === 'string' ? property.value : property.type
        if (property.type === 'string') {
            // escaping ?
            if (property.size > property.value.length) {
                // get value
                const p2 = await property.context.stackFrame.connection.sendPropertyValueNameCommand(
                    property.fullName,
                    property.context
                )
                displayValue = p2.value
            }
            displayValue = `'${displayValue}'`
        } else if (property.type === 'bool') {
            displayValue = Boolean(parseInt(displayValue, 10)).toString()
        }
    }
    return displayValue
}
